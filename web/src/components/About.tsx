import { APP_VERSION, GIT_SHA, LICENSE_NAME, LICENSE_URL, SOURCE_URL } from '../buildInfo';
import { useI18n } from '../i18n/context';
import { GitHubIcon } from './icons';

/** Last section of the settings sheet: name, tagline, build, source and license links. */
export function About() {
  const { t } = useI18n();
  return (
    <section className="settings-group about" data-testid="about">
      <h3>{t.aboutTitle}</h3>
      <p className="about-name">
        <strong>{t.appTitle}</strong> – {t.tagline}
      </p>
      <p className="about-version" data-testid="app-version">
        {t.aboutVersion.replace('{value}', `${APP_VERSION} · ${GIT_SHA}`)}
      </p>
      <div className="about-links">
        <a
          className="about-link"
          href={SOURCE_URL}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="source-link"
        >
          <GitHubIcon size={18} />
          <span>{t.sourceCode}</span>
          <span className="visually-hidden">{t.opensNewTab}</span>
        </a>
        <a
          className="about-link"
          href={LICENSE_URL}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="license-link"
        >
          <span>
            {t.license} {LICENSE_NAME}
          </span>
          <span className="visually-hidden">{t.opensNewTab}</span>
        </a>
      </div>
    </section>
  );
}
