import type { ReactNode } from 'react'
import type { AgentName } from '../api.ts'

/**
 * A little person sitting at their desk, dressed for the job. Pure SVG; all motion is CSS
 * (index.css, "Agent figures"): breathing and blinking when idle, a job-specific action while
 * working (tapping the calculator, lifting the box, turning the wrench, talking into the headset,
 * gesturing at the team), and turned off for anyone who prefers reduced motion.
 */

interface Look {
  skin: string
  sleeve: string
  torso: ReactNode
  hair: ReactNode
  hairBack?: ReactNode // behind the head
  hat?: ReactNode
  face?: ReactNode // glasses, beard, headset
  prop: ReactNode
  propFront?: boolean
}

const INK = '#1b2434'

const LOOKS: Record<AgentName, Look> = {
  boss: {
    skin: '#8d5524',
    sleeve: '#0f2747',
    hairBack: <ellipse cx="80" cy="36" rx="28" ry="24" fill="#1a1110" />,
    hair: <path d="M60 46 Q58 22 80 21 Q102 22 100 46 Q97 33 80 31 Q63 33 60 46 Z" fill="#1a1110" />,
    torso: (
      <>
        <path d="M44 136 L44 98 Q44 80 62 76 L98 76 Q116 80 116 98 L116 136 Z" fill="#0f2747" />
        <path d="M70 76 L80 100 L90 76 Z" fill="#f7f5ef" />
        <path d="M74 78 Q80 84 86 78" fill="none" stroke="#c9d3e0" strokeWidth="1.4" />
        <circle cx="95" cy="88" r="2.6" fill="#2456d3" stroke="#b9d4f1" strokeWidth="1" />
        <path d="M68 76 L78 100 L66 90 Z M92 76 L82 100 L94 90 Z" fill="#1d3b66" />
        <circle cx="80" cy="112" r="1.6" fill="#5d6779" />
        <circle cx="80" cy="122" r="1.6" fill="#5d6779" />
      </>
    ),
    prop: (
      <g className="prop prop-mug">
        <rect x="18" y="117" width="30" height="7" rx="1.5" fill="#ffffff" stroke="#c9d3e0" />
        <rect x="21" y="112" width="26" height="5" rx="1" fill="#e8f1fb" stroke="#c9d3e0" />
        <g className="mug">
          <path d="M120 104 h16 v16 q0 4 -4 4 h-8 q-4 0 -4 -4 Z" fill="#ffffff" stroke="#b9d4f1" strokeWidth="1.5" />
          <path d="M136 108 q7 0 7 6 q0 6 -7 6" fill="none" stroke="#b9d4f1" strokeWidth="2.5" />
          <text x="128" y="117" textAnchor="middle" fontSize="7" fontWeight="900" fontStyle="italic" fill="#2456d3">CC</text>
          <path className="steam" d="M125 100 q-3 -4 0 -8 q3 -4 0 -8 M131 100 q-3 -4 0 -8 q3 -4 0 -8" fill="none" stroke="#b9d4f1" strokeWidth="1.6" strokeLinecap="round" />
        </g>
      </g>
    ),
  },
  inventory: {
    skin: '#ffdbac',
    sleeve: '#2456d3',
    hairBack: <path d="M94 36 Q114 40 110 64 Q107 70 104 66 Q106 52 96 46 Z" fill="#c8963e" />,
    hair: <path d="M61 47 Q59 36 64 32 L96 32 Q101 36 99 47 Q96 38 80 37 Q64 38 61 47 Z" fill="#c8963e" />,
    hat: (
      <g>
        <path d="M60 37 Q60 17 80 17 Q100 17 100 37 Z" fill="#f2c230" />
        <path d="M78 17.5 h4 v19 h-4 Z" fill="#e0ab12" />
        <rect x="55" y="35" width="50" height="5.5" rx="2.75" fill="#e0ab12" />
      </g>
    ),
    torso: (
      <>
        <path d="M44 136 L44 98 Q44 80 62 76 L98 76 Q116 80 116 98 L116 136 Z" fill="#2456d3" />
        <path d="M46 136 L46 98 Q46 82 62 78 L72 78 L74 136 Z M114 136 L114 98 Q114 82 98 78 L88 78 L86 136 Z" fill="#ef6c00" />
        <rect x="46" y="104" width="28" height="5" fill="#e9eef5" />
        <rect x="86" y="104" width="28" height="5" fill="#e9eef5" />
        <rect x="60" y="80" width="5" height="56" fill="#e9eef5" opacity="0.9" />
        <rect x="95" y="80" width="5" height="56" fill="#e9eef5" opacity="0.9" />
      </>
    ),
    propFront: true,
    prop: (
      <g className="prop prop-box">
        <rect x="66" y="96" width="28" height="28" rx="2" fill="#c8955a" />
        <path d="M66 96 h28 l-4 -6 h-20 Z" fill="#d9a873" />
        <rect x="77" y="96" width="6" height="28" fill="#e8d3a8" opacity="0.85" />
        <rect x="68.5" y="104" width="7" height="7" rx="1" fill="#f7f5ef" />
        <text x="72" y="109.6" textAnchor="middle" fontSize="5.5" fontWeight="800" fill={INK}>M</text>
        <path d="M86 113 v6 M87.6 113 v6 M89.8 113 v6 M91.4 113 v6" stroke="#6b4a2c" strokeWidth="0.9" />
      </g>
    ),
  },
  accounting: {
    skin: '#c68642',
    sleeve: '#f4f6fa',
    hair: <path d="M61 43 Q59 24 80 23 Q101 24 99 43 Q97 33 88 31 Q78 34 66 31 Q62 36 61 43 Z" fill="#1a1110" />,
    hat: (
      <g>
        <path d="M60 34 Q80 27 100 34" fill="none" stroke="#1b5e20" strokeWidth="3" />
        <path d="M57 35 Q80 28 103 35 L108 42 Q80 34 52 42 Z" fill="#2e7d32" opacity="0.88" />
      </g>
    ),
    face: (
      <g fill="none" stroke={INK} strokeWidth="1.4">
        <circle cx="73" cy="48" r="5" />
        <circle cx="87" cy="48" r="5" />
        <path d="M78 48 h4" />
      </g>
    ),
    torso: (
      <>
        <path d="M44 136 L44 98 Q44 80 62 76 L98 76 Q116 80 116 98 L116 136 Z" fill="#f4f6fa" />
        <path d="M52 136 L52 92 Q54 84 64 82 L80 104 L96 82 Q106 84 108 92 L108 136 Z" fill="#b9d4f1" />
        <path d="M66 112 l6 -7 l6 7 l-6 7 Z M82 112 l6 -7 l6 7 l-6 7 Z M74 126 l6 -7 l6 7 l-6 7 Z" fill="#9ec0ea" />
        <path d="M74 78 L80 82 L74 86 Z M86 78 L80 82 L86 86 Z" fill="#00356b" />
        <circle cx="80" cy="82" r="1.8" fill="#00356b" />
      </>
    ),
    prop: (
      <g className="prop prop-calc">
        <rect x="18" y="114" width="28" height="10" rx="1.5" fill="#ffffff" stroke="#c9d3e0" />
        <path d="M22 118 h18 M22 121 h12" stroke="#b9c3d0" strokeWidth="1.2" />
        <g transform="rotate(-8 117 114)">
          <rect x="104" y="100" width="28" height="26" rx="3" fill="#263238" />
          <rect x="107" y="103" width="22" height="7" rx="1" fill="#b5d6a7" />
          <text className="calc-digits" x="127.5" y="108.6" textAnchor="end" fontSize="5.5" fontFamily="monospace" fill="#1b3a17">840.00</text>
          {[0, 1, 2, 3].map((col) =>
            [0, 1, 2].map((row) => (
              <rect key={`${col}-${row}`} x={107 + col * 5.6} y={112.5 + row * 4.2} width="4" height="3" rx="0.6" fill={col === 3 ? '#ef6c00' : '#90a4ae'} />
            )),
          )}
        </g>
      </g>
    ),
  },
  facilities: {
    skin: '#e0ac69',
    sleeve: '#4a6a94',
    hair: <path d="M60 36 L100 36 Q104 52 98 64 Q96 66 94 63 Q97 50 92 40 L68 40 Q63 50 66 63 Q64 66 62 64 Q56 52 60 36 Z" fill="#2b1d14" />,
    hat: (
      <g>
        <path d="M60 37 Q61 19 80 19 Q99 19 100 37 Z" fill="#00356b" />
        <path d="M96 35 Q112 34 116 39 L98 40 Z" fill="#0a1f3d" />
        <circle cx="80" cy="20" r="2" fill="#2456d3" />
        <text x="80" y="32" textAnchor="middle" fontSize="7" fontWeight="900" fontStyle="italic" fill="#ffffff">C</text>
      </g>
    ),
    torso: (
      <>
        <path d="M44 136 L44 98 Q44 80 62 76 L98 76 Q116 80 116 98 L116 136 Z" fill="#4a6a94" />
        <path d="M66 76 L80 90 L72 94 Z M94 76 L80 90 L88 94 Z" fill="#3b5779" />
        <path d="M80 90 V136" stroke="#2f4867" strokeWidth="1.6" />
        <rect x="88" y="100" width="18" height="13" rx="1.5" fill="#3b5779" />
        <ellipse cx="65" cy="104" rx="9" ry="5" fill="#f7f5ef" />
        <text x="65" y="106" textAnchor="middle" fontSize="5" fontWeight="800" fill="#00356b">FAC</text>
      </>
    ),
    propFront: true,
    prop: (
      <g className="prop prop-tools">
        <g>
          <rect x="12" y="108" width="36" height="16" rx="2" fill="#c62828" />
          <rect x="12" y="108" width="36" height="4" fill="#a31f1f" />
          <path d="M24 108 v-5 h12 v5" fill="none" stroke="#5d6779" strokeWidth="2.5" />
          <rect x="27" y="114" width="6" height="3" rx="1" fill="#e9eef5" />
        </g>
        <g className="wrench">
          <path d="M99 120 L109 92" stroke="#9aa5b1" strokeWidth="4.5" strokeLinecap="round" />
          <path d="M104 88 a7 7 0 1 0 11 5 l-5 -1 l-1 -5 Z" fill="#9aa5b1" />
        </g>
      </g>
    ),
  },
  customer_service: {
    skin: '#f1c27d',
    sleeve: '#b9d4f1',
    hair: <path d="M61 44 Q57 24 72 22 Q80 18 88 22 Q103 24 99 44 Q97 34 92 31 Q86 35 80 31 Q74 35 68 31 Q63 36 61 44 Z" fill="#6b4423" />,
    face: (
      <g>
        <path d="M60 46 Q60 18 80 18 Q100 18 100 46" fill="none" stroke="#263238" strokeWidth="3" />
        <rect x="55" y="41" width="8" height="13" rx="3" fill="#263238" />
        <rect x="97" y="41" width="8" height="13" rx="3" fill="#263238" />
        <path d="M59 53 Q60 62 72 61" fill="none" stroke="#263238" strokeWidth="2" />
        <circle cx="73" cy="61" r="2.4" fill="#2456d3" />
        <g className="soundwaves" fill="none" stroke="#2456d3" strokeWidth="1.6" strokeLinecap="round">
          <path d="M50 58 q-4 4 0 8" />
          <path d="M45 55 q-6 7 0 14" />
        </g>
      </g>
    ),
    torso: (
      <>
        <path d="M44 136 L44 98 Q44 80 62 76 L98 76 Q116 80 116 98 L116 136 Z" fill="#b9d4f1" />
        <path d="M68 76 L80 98 L92 76 Z" fill="#f7f5ef" />
        <path d="M80 98 V136" stroke="#9ec0ea" strokeWidth="1.6" />
        <circle cx="80" cy="108" r="1.6" fill="#7fa8e0" />
        <circle cx="80" cy="120" r="1.6" fill="#7fa8e0" />
        <rect x="88" y="94" width="18" height="10" rx="2" fill="#ffffff" stroke="#2456d3" strokeWidth="1" />
        <rect x="91" y="97" width="12" height="1.6" fill="#2456d3" />
        <rect x="91" y="100" width="8" height="1.4" fill="#9ec0ea" />
      </>
    ),
    prop: (
      <g className="prop prop-laptop">
        <path d="M108 124 L112 98 L148 98 L144 124 Z" fill="#c9d3e0" />
        <path d="M108 124 L144 124 L146 126 L106 126 Z" fill="#9aa5b1" />
        <text x="128" y="115" textAnchor="middle" fontSize="11" fontWeight="900" fontStyle="italic" fill="#ffffff" stroke="#2456d3" strokeWidth="0.6">C</text>
        <g>
          <rect x="16" y="106" width="30" height="18" rx="2" fill="#ffffff" stroke="#b9d4f1" />
          <path d="M16 108 L31 117 L46 108" fill="none" stroke="#2456d3" strokeWidth="1.4" />
        </g>
      </g>
    ),
  },
}

export default function AgentFigure({ agent, mood }: { agent: AgentName; mood: 'idle' | 'working' | 'done' | 'error' }) {
  const look = LOOKS[agent]
  return (
    <svg className={`figure figure-${agent} is-${mood}`} viewBox="0 0 160 136" role="img" aria-label={`${agent.replace('_', ' ')} agent, ${mood}`}>
      {/* chair */}
      <rect x="40" y="56" width="80" height="78" rx="16" fill="#1b2f4f" />
      <rect x="46" y="62" width="68" height="70" rx="12" fill="#22395e" />

      <g className="body">
        <g className="torso">{look.torso}</g>
        <rect x="72" y="62" width="16" height="17" rx="5" fill={look.skin} />
        <g className="head">
          {look.hairBack}
          <circle cx="60.5" cy="49" r="5" fill={look.skin} />
          <circle cx="99.5" cy="49" r="5" fill={look.skin} />
          <ellipse cx="80" cy="47" rx="19.5" ry="21.5" fill={look.skin} />
          {look.hair}
          <g className="eyes" fill={INK}>
            <ellipse cx="73" cy="48" rx="2.2" ry="2.5" />
            <ellipse cx="87" cy="48" rx="2.2" ry="2.5" />
          </g>
          <path d="M69.5 42 q3.5 -2 7 0 M83.5 42 q3.5 -2 7 0" fill="none" stroke={INK} strokeWidth="1.3" strokeLinecap="round" opacity="0.7" />
          <ellipse className="cheek" cx="68" cy="55" rx="3" ry="1.8" fill="#e57373" opacity="0.25" />
          <ellipse className="cheek" cx="92" cy="55" rx="3" ry="1.8" fill="#e57373" opacity="0.25" />
          <path className="smile" d="M74 57.5 Q80 62.5 86 57.5" fill="none" stroke="#7a3b2e" strokeWidth="1.8" strokeLinecap="round" />
          <ellipse className="talk" cx="80" cy="59" rx="3.4" ry="2.6" fill="#7a3b2e" />
          {look.face}
          {look.hat}
        </g>
      </g>

      {!look.propFront && look.prop}

      {/* arms, hands resting on the desk */}
      <g className="arm arm-l">
        <path d="M52 86 Q44 104 48 116 L62 121" fill="none" stroke={look.sleeve} strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="63" cy="121" r="5.8" fill={look.skin} />
      </g>
      <g className="arm arm-r">
        <path d="M108 86 Q116 104 112 116 L98 121" fill="none" stroke={look.sleeve} strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="97" cy="121" r="5.8" fill={look.skin} />
      </g>

      {look.propFront && look.prop}

      {/* desk top */}
      <rect x="0" y="124" width="160" height="12" fill="#a8754f" />
      <rect x="0" y="124" width="160" height="2.5" fill="#c4916a" />
    </svg>
  )
}
