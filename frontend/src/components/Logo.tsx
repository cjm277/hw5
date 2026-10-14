/**
 * The Campus Customs wordmark, rebuilt in type to match the store's logo: an oversized italic "C"
 * shared by "AMPUS" and "USTOMS", heavy squared sports lettering, and "EST. 1975" underneath.
 */
export default function Logo({ variant = 'dark' }: { variant?: 'dark' | 'light' }) {
  return (
    <span className={`cc-logo cc-logo-${variant}`} aria-label="Campus Customs, established 1975" role="img">
      <span className="cc-logo-mark" aria-hidden="true">
        <span className="cc-logo-c">C</span>
        <span className="cc-logo-words">
          <span>AMPUS</span>
          <span>USTOMS</span>
        </span>
      </span>
      <span className="cc-logo-est" aria-hidden="true">
        EST. 1975
      </span>
    </span>
  )
}
