import '../styles/Navbar.css';

export default function Navbar() {
  return (
    <header className="navbar">
      <div className="navbar-left">
        <div className="navbar-brand">
          <span className="navbar-brand-title">VOLKSWAGEN</span>
          <span className="navbar-brand-subtitle">PERSONAL PORTAL</span>
        </div>
        <button className="icon-btn" title="Menü">
          <i className="fa-solid fa-circle-chevron-down" />
        </button>
      </div>

      <div className="navbar-right">
        <button className="icon-btn" title="Suchen"><i className="fa-solid fa-magnifying-glass" /></button>
        <button className="icon-btn" title="Verlauf"><i className="fa-solid fa-clock-rotate-left" /></button>
        <button className="icon-btn" title="Sichern"><i className="fa-regular fa-bookmark" /></button>
        <button className="icon-btn" title="Hilfe"><i className="fa-solid fa-circle-question" /></button>
        <button className="icon-btn" title="Benachrichtigungen"><i className="fa-solid fa-bell" /></button>
        <div className="circle-icon" title="Benutzer"><i className="fa-solid fa-user" /></div>
        <button className="icon-btn" title="Mehr"><i className="fa-solid fa-ellipsis-vertical" /></button>
      </div>

      <div className="navbar-right-mobile">
        <div className="circle-icon" title="Benutzer">LS</div>
        <button className="icon-btn" title="Mehr"><i className="fa-solid fa-ellipsis-vertical" /></button>
      </div>
    </header>
  );
}
