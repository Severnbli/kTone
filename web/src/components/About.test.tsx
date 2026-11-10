import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { APP_VERSION, GIT_SHA } from '../buildInfo';
import { I18nProvider } from '../i18n/I18nProvider';
import { About } from './About';

describe('About', () => {
  it('links to the source code and the license in a new tab', () => {
    render(
      <I18nProvider lang="ru">
        <About />
      </I18nProvider>,
    );
    expect(screen.getByRole('heading', { name: 'О kTone' })).toBeInTheDocument();

    const source = screen.getByRole('link', { name: /Исходный код на GitHub/ });
    expect(source).toHaveAttribute('href', 'https://github.com/Severnbli/kTone');
    expect(source).toHaveAttribute('target', '_blank');
    expect(source).toHaveAttribute('rel', 'noopener noreferrer');
    expect(source).toHaveAccessibleName('Исходный код на GitHub (откроется в новой вкладке)');

    const license = screen.getByRole('link', { name: /Лицензия GPL-3\.0/ });
    expect(license).toHaveAttribute('href', 'https://github.com/Severnbli/kTone/blob/main/LICENSE');
    expect(license).toHaveAttribute('target', '_blank');
    expect(license).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('shows the package version and the build', () => {
    render(
      <I18nProvider lang="en">
        <About />
      </I18nProvider>,
    );
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(GIT_SHA).toMatch(/^(dev|[0-9a-f]{7})$/);
    expect(screen.getByTestId('app-version')).toHaveTextContent(
      `Version ${APP_VERSION} · ${GIT_SHA}`,
    );
    expect(screen.getByRole('link', { name: /Source code on GitHub/ })).toBeInTheDocument();
  });
});
