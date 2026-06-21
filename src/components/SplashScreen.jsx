import './SplashScreen.css';

export default function SplashScreen({ tagline = 'BEAUTÉ SÉNÉGAL' }) {
  return (
    <div className="yspl-screen">
      <div className="yspl-logo-wrap">
        {/* Logo officiel YARAM — meme SVG inline que le boot dans index.html */}
        <div className="yspl-logo">
          <svg viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg" aria-label="YARAM">
            <rect fill="rgba(255,255,255,0.1)" x="0" y="0" width="256" height="256" rx="40" ry="40"/>
            <g transform="translate(-22 -8) scale(1.2)">
              <path fill="#fff" d="M153.9,64.45l-20.93,30.57-21.02-30.57h-24.32l28.48,41.39v58.66h23.8v-60.88l26.87-39.16h-12.87Z"/>
            </g>
            <circle fill="#e94e1b" cx="195" cy="195" r="14"/>
          </svg>
        </div>
        <div className="yspl-tagline">{tagline}</div>
      </div>
      <div className="yspl-loader">
        <div className="yspl-loader-dot" />
        <div className="yspl-loader-dot" />
        <div className="yspl-loader-dot" />
      </div>
    </div>
  );
}
