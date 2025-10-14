// avatar.ts
import StreamingAvatar, {
  AvatarQuality,
  StreamingEvents,
} from '@heygen/streaming-avatar';

let avatar: StreamingAvatar | null = null;
let isStarting = false;
let finalCountdownStarted = false; 
let isAvatarSpeaking = false;

// UI-Elemente
const videoEl    = document.getElementById('avatarVideo')      as HTMLVideoElement;
const speakButtonEl = document.getElementById('speakButton')     as HTMLButtonElement;
const userInputEl   = document.getElementById('userInput')       as HTMLTextAreaElement;
const connectingOverlayEl  = document.getElementById('connecting-overlay')!;
const dotsElSpan   = document.getElementById('dots')!;
let avatarHumanConnectPromptContainerEl: HTMLElement | null = null;
let avatarHumanConnectYesButtonEl: HTMLButtonElement | null = null;
let avatarHumanConnectNoButtonEl: HTMLButtonElement | null = null;

// Konfiguration
const API_BASE_URL                = import.meta.env.VITE_API_BASE || 'http://localhost:3000';
const FALLBACK_SOSCI_SURVEY_URL = 'https://www.soscisurvey.de/digital_HR_agents/';

// URLs für normalen Abschluss
const REDIRECT_URL_AVATAR_SOC_NORMAL_BASE = import.meta.env.VITE_REDIRECT_URL_AVATAR_SOC || FALLBACK_SOSCI_SURVEY_URL;
const REDIRECT_URL_AVATAR_INS_NORMAL_BASE = import.meta.env.VITE_REDIRECT_URL_AVATAR_INS || FALLBACK_SOSCI_SURVEY_URL;

// URLs für "Connect to Human" Abschluss
const REDIRECT_URL_AVATAR_SOC_HUMAN_BASE   = import.meta.env.VITE_REDIRECT_URL_AVATAR_SOC_HUMAN || FALLBACK_SOSCI_SURVEY_URL;
const REDIRECT_URL_AVATAR_INS_HUMAN_BASE   = import.meta.env.VITE_REDIRECT_URL_AVATAR_INS_HUMAN || FALLBACK_SOSCI_SURVEY_URL;

const MAX_INTERACTIONS        = 5;
const HUMAN_CONNECT_PROMPT_THRESHOLD = 3;
const MAX_API_RETRIES         = 2;
const SESSION_RETRY_COOLDOWN_MS = 10000;

// Statusvariablen
let interactionCount     = 0;
let dotAnimationIntervalId: number | null = null;
let currentAvatarStyleInternal: 'soc' | 'ins' = 'soc';
let avatarHumanConnectPromptShownThisSession = false;
let userMessagesLogAvatar: string[] = []; // NEU: Array zum Speichern von User-Nachrichten für Avatar

// Schlüssel für LocalStorage
const SURVEY_REDIRECT_TOKEN_KEY = 'surveyRedirectToken';
const EXPERIMENT_HUMAN_CONNECT_KEY = 'experimentHumanConnect';
const USER_MESSAGES_LOG_KEY = 'userMessagesLog'; // NEU: Für gesammelte Nachrichten

/**
 * Hängt die gespeicherten Survey Parameter an eine Basis-URL an.
 * @param baseUrlString Die Basis-URL zur SoSci Survey.
 * @param optedForHumanConnect Gibt an, ob der User mit einem Menschen verbunden werden wollte.
 */
function appendSurveyParamsToUrlLocal(baseUrlString: string, optedForHumanConnect: boolean): string {
  const token = localStorage.getItem(SURVEY_REDIRECT_TOKEN_KEY);
  const messages = localStorage.getItem(USER_MESSAGES_LOG_KEY); // NEU
  try {
    const url = new URL(baseUrlString);
    if (token) {
      url.searchParams.append('i', token);
    }
    url.searchParams.append('hc', optedForHumanConnect ? '1' : '0');
    if (messages) { // NEU
      url.searchParams.append('msgs', messages);
    }
    return url.toString();
  } catch (error) {
    console.error("Error constructing URL with params in avatar.ts:", error, "Base URL was:", baseUrlString);
    let fallbackUrl = baseUrlString;
    const params: string[] = [];
    if (token) params.push(`i=${encodeURIComponent(token)}`);
    params.push(`hc=${optedForHumanConnect ? '1' : '0'}`);
    if (messages) params.push(`msgs=${encodeURIComponent(messages)}`); // NEU
    if (params.length > 0) {
      fallbackUrl += (fallbackUrl.includes('?') ? '&' : '?') + params.join('&');
    }
    return fallbackUrl;
  }
}

function updateAvatarProgressUI() {
  const el = document.getElementById('avatar-progress');
  if (!el) return;
  const circle = el.querySelector('.circle') as SVGPathElement;
  const text   = el.querySelector('.progress-text')!;
  const percent = (interactionCount / MAX_INTERACTIONS) * 100;

  text.textContent = interactionCount < MAX_INTERACTIONS ? `${interactionCount}/${MAX_INTERACTIONS}` : '✓';
  circle.style.strokeDashoffset = (100 - percent).toString();
}

function startFinalCountdown() { 
  const el = document.getElementById('avatar-progress');
  if (!el || finalCountdownStarted || !speakButtonEl || !userInputEl) return;
  console.log("AVATAR: MAX_INTERACTIONS erreicht, starte finalen Countdown.");
  finalCountdownStarted = true;

  const text = el.querySelector('.progress-text')!;
  let seconds = 10; 
  text.textContent = `${seconds}s`;
  speakButtonEl.disabled = true;
  userInputEl.disabled = true;

  const countdownTimerId = setInterval(async () => {
    seconds--;
    text.textContent = seconds > 0 ? `${seconds}s` : '✓';
    if (seconds === 0) {
      clearInterval(countdownTimerId);
      localStorage.setItem('experimentRedirectMode', 'avatar');
      localStorage.setItem('experimentRedirectStyle', currentAvatarStyleInternal);
      localStorage.setItem('experimentDone', 'true');
      localStorage.removeItem(EXPERIMENT_HUMAN_CONNECT_KEY); 

      // NEU: Gesammelte Nachrichten im localStorage speichern
      localStorage.setItem(USER_MESSAGES_LOG_KEY, userMessagesLogAvatar.join('$'));

      const baseRedirectUrl = currentAvatarStyleInternal === 'soc' ? REDIRECT_URL_AVATAR_SOC_NORMAL_BASE : REDIRECT_URL_AVATAR_INS_NORMAL_BASE;
      const finalRedirectUrl = appendSurveyParamsToUrlLocal(baseRedirectUrl, false); 
      
      await stopAvatar();
      window.location.href = finalRedirectUrl;
    }
  }, 1000);
}

export async function stopAvatar() {
  if (avatar) {
    try {
      await avatar.stopAvatar();
    } catch (err) {
      console.warn('Fehler beim Stoppen des Avatars:', err);
    }
    avatar = null;
  }
  if (videoEl && videoEl.srcObject) {
    const stream = videoEl.srcObject as MediaStream;
    stream.getTracks().forEach(track => track.stop());
    videoEl.srcObject = null;
  }
  isStarting = false;
  isAvatarSpeaking = false;
  if (speakButtonEl) speakButtonEl.disabled = true;
  if (userInputEl) userInputEl.disabled = true;
  if (dotAnimationIntervalId) {
    clearInterval(dotAnimationIntervalId);
    dotAnimationIntervalId = null;
  }
  console.log("Avatar-Session durch stopAvatar() beendet.");
}

export async function startAvatar(style: 'soc' | 'ins') { 
  if (localStorage.getItem('experimentDone') === 'true') return;
  if (isStarting) {
    console.warn("Avatar Start ist bereits im Gange.");
    return;
  }
  isStarting = true;
  currentAvatarStyleInternal = style;
  userMessagesLogAvatar = []; // NEU: Nachrichten-Log für Avatar zurücksetzen


  avatarHumanConnectPromptContainerEl = document.getElementById('avatar-human-connect-prompt');
  avatarHumanConnectYesButtonEl = document.getElementById('avatar-human-connect-yes') as HTMLButtonElement | null;
  avatarHumanConnectNoButtonEl = document.getElementById('avatar-human-connect-no') as HTMLButtonElement | null;

  if (!videoEl || !speakButtonEl || !userInputEl || !connectingOverlayEl || !dotsElSpan || !avatarHumanConnectPromptContainerEl || !avatarHumanConnectYesButtonEl || !avatarHumanConnectNoButtonEl ) {
      console.error("Einige grundlegende UI-Elemente für Avatar nicht gefunden beim Start!");
      isStarting = false;
      return;
  }

  videoEl.play().catch(e => console.warn("Video play() initial fehlgeschlagen:", e));
  
  interactionCount = 0;
  finalCountdownStarted = false;
  isAvatarSpeaking = false;
  avatarHumanConnectPromptShownThisSession = false;
  avatarHumanConnectPromptContainerEl.classList.add('hidden');

  updateAvatarProgressUI();
  speakButtonEl.disabled = true;
  userInputEl.disabled = true;

  connectingOverlayEl.style.display = 'flex';
  dotsElSpan.textContent = '.';
  let dotState = 1;
  if (dotAnimationIntervalId) clearInterval(dotAnimationIntervalId);
  dotAnimationIntervalId = window.setInterval(() => {
    dotState = (dotState % 3) + 1;
    if (dotsElSpan) dotsElSpan.textContent = '.'.repeat(dotState);
  }, 500);

  userInputEl.removeEventListener('input', handleAvatarInputResize);
  userInputEl.addEventListener('input', handleAvatarInputResize);
  userInputEl.removeEventListener('keydown', handleAvatarInputKeydown);
  userInputEl.addEventListener('keydown', handleAvatarInputKeydown);
  userInputEl.removeEventListener('focus', handleAvatarInputFocus);
  userInputEl.addEventListener('focus', handleAvatarInputFocus);
  
  avatarHumanConnectYesButtonEl.onclick = null;
  avatarHumanConnectYesButtonEl.onclick = () => handleAvatarHumanConnectionChoice(true);
  avatarHumanConnectNoButtonEl.onclick = null;
  avatarHumanConnectNoButtonEl.onclick = () => handleAvatarHumanConnectionChoice(false);

  speakButtonEl.onclick = null;
  speakButtonEl.onclick = async () => {
    if (!avatar || isAvatarSpeaking || speakButtonEl!.disabled || finalCountdownStarted) {
        return;
    }
    
    const text = userInputEl!.value.trim();
    if (!text) return;

    userMessagesLogAvatar.push(text); // NEU: User-Nachricht zum Avatar-Log hinzufügen

    isAvatarSpeaking = true;
    speakButtonEl!.disabled = true;

    try {
        if (interactionCount < MAX_INTERACTIONS && !finalCountdownStarted) {
            interactionCount++;
            updateAvatarProgressUI();
        }
        await avatar.speak({ text });
        userInputEl!.value = '';
        handleAvatarInputResize();
    } catch (error) {
        console.error("Fehler bei avatar.speak:", error);
        isAvatarSpeaking = false;
        const promptIsCurrentlyVisible = avatarHumanConnectPromptContainerEl && !avatarHumanConnectPromptContainerEl.classList.contains('hidden');
        if (!finalCountdownStarted && !promptIsCurrentlyVisible) {
            speakButtonEl!.disabled = false;
        }
    }
  };

  try {
    let { knowledgeBase } = await fetch(
      `${API_BASE_URL}/api/hr-prompt?style=${currentAvatarStyleInternal}`
    ).then(res => {
        if (!res.ok) throw new Error(`Fehler beim Abrufen von hr-prompt: ${res.status}`);
        return res.json();
    });

    let sessionSuccessfullyStarted = false;
    for (let attempt = 1; attempt <= MAX_API_RETRIES && !sessionSuccessfullyStarted; attempt++) {
      try {
        const tokenRes = await fetch(`${API_BASE_URL}/api/get-access-token`);
        if (!tokenRes.ok) throw new Error(`Fehler beim Abrufen des Tokens: ${tokenRes.status} - ${await tokenRes.text()}`);
        const { token } = await tokenRes.json();
        if (!token) throw new Error('Ungültiger oder fehlender Token');

        if (avatar) await stopAvatar();
        avatar = new StreamingAvatar({ token });

        avatar.on(StreamingEvents.STREAM_READY, async (e: any) => { 
          if (videoEl) {
            videoEl.srcObject = e.detail as MediaStream;
            await videoEl.play().catch(err => console.warn("Error playing video on stream_ready:", err));
          }
          if (connectingOverlayEl) connectingOverlayEl.style.display = 'none';
          if (dotAnimationIntervalId) {
            clearInterval(dotAnimationIntervalId);
            dotAnimationIntervalId = null;
          }
          const promptIsCurrentlyVisible = avatarHumanConnectPromptContainerEl && !avatarHumanConnectPromptContainerEl.classList.contains('hidden');
          if (!finalCountdownStarted && !promptIsCurrentlyVisible) {
             if (speakButtonEl) speakButtonEl.disabled = false;
             if (userInputEl) userInputEl.disabled = false;
             if (userInputEl) userInputEl.focus();
          }

          const greeting = currentAvatarStyleInternal === 'soc'
            ? 'Hallo! Schön, dass du da bist. Ich bin hier um dich zu unterstützen. Was beschäftigt dich gerade am meisten?'
            : 'Willkommen. Bitte geben Sie Ihr Anliegen ein.';
          if (avatar) {
             await avatar.speak({ text: greeting });
          }
        });

        avatar.on(StreamingEvents.AVATAR_START_TALKING, () => {
          isAvatarSpeaking = true;
          if (speakButtonEl) speakButtonEl.disabled = true;
        });

        avatar.on(StreamingEvents.AVATAR_STOP_TALKING, () => {
          isAvatarSpeaking = false;
          handleAvatarResponseLogic();
        });
        
        knowledgeBase += '\n\nDu bist June, dein Name ist June und du bist ein virtueller HR-Assistent.';
        await avatar.createStartAvatar({
          quality: AvatarQuality.High,
          avatarName: 'June_HR_public',
          language: 'de',
          knowledgeBase,
        });
        sessionSuccessfullyStarted = true;
      } catch (err: any) {
        console.error(`Avatar attempt ${attempt} failed:`, err);
        const status = err?.status || (err instanceof Error && (err as any).status);
        await stopAvatar();
        if ((status === 400 || err.message?.includes('400')) && attempt < MAX_API_RETRIES) {
          await new Promise(res => setTimeout(res, SESSION_RETRY_COOLDOWN_MS));
        } else if (attempt >= MAX_API_RETRIES) {
            throw err; 
        }
      }
    }
    if (!sessionSuccessfullyStarted) throw new Error(`Avatar konnte nach ${MAX_API_RETRIES} Versuchen nicht gestartet werden`);
  } catch (err) {
    console.error('Avatar-Start endgültig fehlgeschlagen:', err);
    if (dotAnimationIntervalId) clearInterval(dotAnimationIntervalId);
    if (connectingOverlayEl) {
        connectingOverlayEl.textContent = '❌ Verbindung fehlgeschlagen – bitte Seite neu laden';
        connectingOverlayEl.style.display = 'flex';
    }
    if (speakButtonEl) speakButtonEl.disabled = true;
    if (userInputEl) userInputEl.disabled = true;
  } finally {
    isStarting = false;
  }
}

function handleAvatarResponseLogic() {
    if (finalCountdownStarted) return;

    const promptIsCurrentlyVisible = avatarHumanConnectPromptContainerEl && !avatarHumanConnectPromptContainerEl.classList.contains('hidden');
    if (promptIsCurrentlyVisible) { 
        return;
    }

    if (interactionCount === HUMAN_CONNECT_PROMPT_THRESHOLD && !avatarHumanConnectPromptShownThisSession) {
        askForHumanConnectionAvatar();
    } 
    else if (interactionCount >= MAX_INTERACTIONS) { 
        startFinalCountdown();
    } 
    else { 
        if (speakButtonEl) speakButtonEl.disabled = isAvatarSpeaking;
        if (userInputEl) {
            userInputEl.disabled = isAvatarSpeaking; 
            if (!isAvatarSpeaking) userInputEl.focus();
        }
    }
}

function askForHumanConnectionAvatar() {
    if (!avatarHumanConnectPromptContainerEl || avatarHumanConnectPromptShownThisSession || finalCountdownStarted) return;
    console.log("Zeige Human-Connect-Prompt für Avatar.");
    avatarHumanConnectPromptShownThisSession = true;
    if (speakButtonEl) speakButtonEl.disabled = true;
    if (userInputEl) userInputEl.disabled = true;
    avatarHumanConnectPromptContainerEl.classList.remove('hidden');
}

function handleAvatarHumanConnectionChoice(userChoseToConnect: boolean) {
    if (avatarHumanConnectPromptContainerEl) {
        avatarHumanConnectPromptContainerEl.classList.add('hidden');
    }

    if (userChoseToConnect) {
        localStorage.setItem('experimentRedirectMode', 'avatar');
        localStorage.setItem('experimentRedirectStyle', currentAvatarStyleInternal);
        localStorage.setItem(EXPERIMENT_HUMAN_CONNECT_KEY, 'yes');
        localStorage.setItem('experimentDone', 'true');

        // NEU: Gesammelte Nachrichten im localStorage speichern
        localStorage.setItem(USER_MESSAGES_LOG_KEY, userMessagesLogAvatar.join('$'));

        const baseRedirectUrl = currentAvatarStyleInternal === 'soc' 
            ? REDIRECT_URL_AVATAR_SOC_HUMAN_BASE 
            : REDIRECT_URL_AVATAR_INS_HUMAN_BASE;
        const finalRedirectUrl = appendSurveyParamsToUrlLocal(baseRedirectUrl, true); 
        
        stopAvatar().then(() => {
            window.location.href = finalRedirectUrl;
        });
    } else { 
        console.log("Benutzer (Avatar) möchte nicht mit Mensch verbunden werden. Interaktion geht weiter.");
        localStorage.removeItem(EXPERIMENT_HUMAN_CONNECT_KEY); 
        if (!finalCountdownStarted) {
            if (speakButtonEl) speakButtonEl.disabled = false;
            if (userInputEl) {
                userInputEl.disabled = false;
                userInputEl.focus();
            }
        }
    }
}

const handleAvatarInputResize = () => {
  if (!userInputEl) return;
  userInputEl.style.height = 'auto';
  userInputEl.style.height = Math.min(userInputEl.scrollHeight, window.innerHeight * 0.3) + 'px';
};

const handleAvatarInputKeydown = (ev: KeyboardEvent) => {
  if (!speakButtonEl || !userInputEl) return;
  if (ev.key === 'Enter' && !ev.shiftKey) {
    ev.preventDefault();
    if (!speakButtonEl.disabled && !finalCountdownStarted) {
        speakButtonEl.click();
    }
  }
};

const handleAvatarInputFocus = () => {
  if (!userInputEl) return;
  setTimeout(() => userInputEl.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
};