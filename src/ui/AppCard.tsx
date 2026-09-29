import type { ComponentChildren } from 'preact';

interface AppCardProps {
  title?: string;
  description?: string;
  children: ComponentChildren;
  className?: string;
}

export function AppCard({ title, description, children, className = '' }: AppCardProps) {
  return (
    <div class={`app-card ${className}`}>
      {(title || description) && (
        <div class="app-card__header">
          {title && <h2 class="app-card__title">{title}</h2>}
          {description && <p class="app-card__description">{description}</p>}
        </div>
      )}
      {children}
    </div>
  );
}
