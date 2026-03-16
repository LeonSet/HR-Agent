import '../styles/Topbar.css';

const NAV_ITEMS = [
  'ME@NOVENTIS',
  'MEINE MITARBEITER',
  'MEIN BETREUUNGSBEREICH',
  'HR PROZESSE',
  'HR PRODUKTKATALOG',
  'WISSEN A - Z',
];

export default function Topbar() {
  return (
    <header className="topbar">
      <button className="topbar-nav-btn prev" aria-label="Vorherige">
        <i className="fa-solid fa-chevron-left" />
      </button>
      <div className="topbar-nav-wrapper">
        <nav className="topbar-nav">
          {NAV_ITEMS.map((item) => (
            <a key={item} href="#">{item}</a>
          ))}
        </nav>
      </div>
      <button className="topbar-nav-btn next" aria-label="Nächste">
        <i className="fa-solid fa-chevron-right" />
      </button>
    </header>
  );
}
