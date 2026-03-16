import '../styles/FloatingTags.css';

interface Props {
  sidebarOpen: boolean;
  onToggle: () => void;
}

const TAGS = [
  { label: 'Kontaktformular', icon: 'fas fa-envelope' },
  { label: 'Regelungen', icon: 'fa-solid fa-section' },
  { label: 'HR Produkte', icon: 'fas fa-boxes' },
  { label: 'Systeme', icon: 'fa-solid fa-circle-nodes' },
];

export default function FloatingTags({ sidebarOpen: _sidebarOpen, onToggle: _onToggle }: Props) {
  return (
    <div className="floating-tags-container">
      {TAGS.map((tag) => (
        <div className="tag-wrapper" key={tag.label}>
          <div className="tag-text-panel"><span>{tag.label}</span></div>
          <div className="tag-icon-circle" title={tag.label}><i className={tag.icon} /></div>
        </div>
      ))}
    </div>
  );
}
