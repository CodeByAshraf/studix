// src/components/ui/Tabs.jsx
import { useState } from 'react';

/**
 * tabs: [{ id, label, icon?, badge? }]
 * content can be provided as children (indexed) or renderTab prop
 */
export default function Tabs({ tabs = [], defaultTab, onChange, children, style }) {
  const [active, setActive] = useState(defaultTab || tabs[0]?.id);

  const handleClick = (id) => {
    setActive(id);
    onChange?.(id);
  };

  return (
    <div style={style}>
      <div className="tabs" style={{ marginBottom: 16 }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`tab-btn ${active === tab.id ? 'active' : ''}`}
            onClick={() => handleClick(tab.id)}
          >
            {tab.icon && <span style={{ marginLeft: 5, fontSize: 13 }}>{tab.icon}</span>}
            {tab.label}
            {tab.badge != null && tab.badge > 0 && (
              <span style={{
                marginRight: 6, background: 'var(--red)', color: '#fff',
                fontSize: 10, fontWeight: 700, padding: '1px 5px',
                borderRadius: 99, minWidth: 16, textAlign: 'center',
              }}>{tab.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* Render matching child by index if children is an array */}
      {Array.isArray(children)
        ? children[tabs.findIndex(t => t.id === active)]
        : children
      }
    </div>
  );
}
