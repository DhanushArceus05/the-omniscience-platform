import type { JSX, ReactNode } from "react";

export interface TabItem {
  key: string;
  label: ReactNode;
  content: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  activeKey: string;
  onChange: (key: string) => void;
}

export function Tabs({ items, activeKey, onChange }: TabsProps): JSX.Element {
  const activeItem = items.find((item) => item.key === activeKey) ?? items[0];

  return (
    <div>
      <div className="omni-tabs__list" role="tablist">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={item.key === activeKey}
            disabled={item.disabled}
            className={`omni-tabs__tab${item.key === activeKey ? " omni-tabs__tab--active" : ""}`}
            onClick={() => onChange(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="omni-tabs__panel omni-motion-fade" role="tabpanel">
        {activeItem?.content}
      </div>
    </div>
  );
}
