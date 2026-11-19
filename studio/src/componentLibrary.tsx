import { useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SearchField } from './components/ui/SearchField';
import './styles/studio.css';
import '../../packages/design-system/studio.css';

function StudioUIExamples() {
  const [theme, setTheme] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const [query, setQuery] = useState('');

  useLayoutEffect(() => {
    if (theme === 'light') document.documentElement.dataset.theme = 'paper';
    else delete document.documentElement.dataset.theme;
  }, [theme]);

  return (
    <main className="h-dvh overflow-auto bg-surface">
      <div className="mx-auto grid max-w-3xl gap-4 px-4 py-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="om-title">Studio UI examples</h1>
          <label className="flex items-center gap-2">
            Theme
            <select className="om-field" value={theme} onChange={event => setTheme(event.currentTarget.value)}>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </header>

        <section className="om-card om-card-stack" aria-labelledby="button-example">
          <h2 id="button-example" className="om-title">Button</h2>
          <p className="om-muted">Use a native button with the shared <code>om-button</code> class.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="om-button">Default</button>
            <button type="button" className="om-button" data-primary>Primary</button>
            <button type="button" className="om-button" disabled>Disabled</button>
          </div>
        </section>

        <section className="om-card om-card-stack" aria-labelledby="search-example">
          <h2 id="search-example" className="om-title">Application search</h2>
          <p className="om-muted">Type a query and clear it to try how <code>SearchField</code> returns focus.</p>
          <SearchField className="w-full" aria-label="Search assets" placeholder="Search assets…" value={query} onChange={setQuery} />
        </section>
      </div>
    </main>
  );
}

createRoot(document.getElementById('ui-examples')!).render(<StudioUIExamples />);
