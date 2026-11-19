import { useLayoutEffect, useState, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { BrandLogo } from '../../react/BrandLogo';
import { Button } from '../button';
import { Slider } from '../slider';
import registry from '../registry.json';
import registryUrl from '../registry.json?url&no-inline';
import './site.css';

const repo = 'https://github.com/nexu-io/openmotion/blob/main/';

function ButtonPreview() {
  return (
    <div className="button-examples">
      <Button type="button" variant="primary">Primary</Button>
      <Button type="button">Secondary</Button>
      <Button type="button" variant="ghost">Ghost</Button>
      <Button type="button" variant="danger">Danger</Button>
      <Button type="button" loading>Saving</Button>
      <Button type="button" disabled>Disabled</Button>
    </div>
  );
}

function SliderPreview() {
  const [value, setValue] = useState(4);
  return (
    <div className="slider-example">
      <div><span>Guidance scale</span><output aria-label="Committed guidance scale">{value}</output></div>
      <Slider label="Guidance scale" min={1} max={10} step={1} value={value} onCommit={setValue} />
    </div>
  );
}

const previews: Record<string, ComponentType> = { button: ButtonPreview, slider: SliderPreview };

function ComponentSite() {
  const [theme, setTheme] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  useLayoutEffect(() => {
    if (theme === 'light') document.documentElement.dataset.theme = 'paper';
    else delete document.documentElement.dataset.theme;
  }, [theme]);

  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <a href="#top" aria-label="OpenMotion Components"><BrandLogo /></a>
          <label>Theme <select className="om-field" value={theme} onChange={event => setTheme(event.currentTarget.value)}>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select></label>
        </div>
      </header>
      <div className="site-layout" id="top">
        <nav aria-label="Components" className="site-nav">
          {registry.items.map(item => <a key={item.name} href={`#${item.name}`}>{item.title}</a>)}
          <a href={registryUrl}>Registry JSON</a>
          <a href={repo + 'packages/design-system/components/README.md'}>Contribute</a>
        </nav>
        <main>
          <h1>Components</h1>
          <p className="site-intro">Preview the shared controls used by OpenMotion Studio.</p>
          {registry.items.map(item => {
            const Preview = previews[item.name];
            return (
              <section key={item.name} id={item.name} aria-labelledby={`${item.name}-title`}>
                <h2 id={`${item.name}-title`}>{item.title}</h2>
                <p>{item.description}</p>
                <div className="preview"><Preview /></div>
                <pre><code>{item.example}</code></pre>
                <div className="entry-links">
                  <a href={repo + item.source}>Source</a>
                  <a href={repo + item.consumer}>Studio usage</a>
                </div>
              </section>
            );
          })}
        </main>
      </div>
    </>
  );
}

createRoot(document.getElementById('catalog-root')!).render(<ComponentSite />);
