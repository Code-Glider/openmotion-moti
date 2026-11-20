import { useId } from 'react';
import { useI18n } from '../i18n/I18n';
import styles from './PricingEntry.module.css';

export function PricingEntry() {
  const { locale } = useI18n();
  const gradientId = useId();
  const zh = locale.startsWith('zh');
  const href = zh ? 'https://open-design.ai/zh/pricing/' : 'https://open-design.ai/pricing/';
  const aria = zh ? 'Pricing · 黑五特惠年付低至 5 折' : 'Pricing · Black Friday up to 50% off';

  return (
    <a
      className={styles.trigger}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={aria}
    >
      <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ff781f" />
            <stop offset="100%" stopColor="#ffb34a" />
          </linearGradient>
        </defs>
        <path
          fill={`url(#${gradientId})`}
          fillRule="evenodd"
          clipRule="evenodd"
          d="M3.5 5.25C3.5 4.2835 4.2835 3.5 5.25 3.5H10.5251C11.1219 3.5 11.6942 3.73705 12.1161 4.15901L19.841 11.8839C20.7197 12.7626 20.7197 14.1872 19.841 15.0659L15.0659 19.841C14.1872 20.7197 12.7626 20.7197 11.8839 19.841L4.15901 12.1161C3.73705 11.6942 3.5 11.1219 3.5 10.5251V5.25ZM8 9.25C8.69036 9.25 9.25 8.69036 9.25 8C9.25 7.30964 8.69036 6.75 8 6.75C7.30964 6.75 6.75 7.30964 6.75 8C6.75 8.69036 7.30964 9.25 8 9.25Z"
        />
      </svg>
      <span className={styles.label}>Pricing</span>
      <span className={styles.badge} aria-hidden="true">
        <span className={styles.badgeText}>50% OFF</span>
      </span>
    </a>
  );
}
