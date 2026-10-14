import { useLayoutEffect, useRef, useState } from 'react'
import { money } from '../floor.ts'

/**
 * The checking balance as slot-machine reels. Each digit is a strip of 0-9 repeated three times.
 * When the balance changes, every reel jumps back to its old digit in the first set and spins
 * forward to the new digit in the third set. Reels settle left to right, like a slot machine.
 */
const DIGIT_H = 1.12 // em, must match .reel height in index.css

export default function SlotBalance({ value }: { value: number | null }) {
  const text = value === null ? '$-,---.--' : money(value)
  const strips = useRef<(HTMLSpanElement | null)[]>([])
  const prevText = useRef<string | null>(null)
  const prevValue = useRef<number | null>(null)
  const spins = useRef(0)
  const [delta, setDelta] = useState<{ amount: number; key: number } | null>(null)

  const chars = text.split('')

  useLayoutEffect(() => {
    const chars = text.split('')
    const before = prevText.current
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const n = chars.length
    chars.forEach((ch, i) => {
      const el = strips.current[i]
      if (!el || !/\d/.test(ch)) return
      const target = 20 + Number(ch)
      // digit in the same place counting from the right, or 0 on the first spin
      const old = before ? before[before.length - (n - i)] : '0'
      const start = old && /\d/.test(old) ? Number(old) : 0
      if (reduce || before === text) {
        el.style.transition = 'none'
        el.style.transform = `translateY(${-target * DIGIT_H}em)`
        return
      }
      el.style.transition = 'none'
      el.style.transform = `translateY(${-start * DIGIT_H}em)`
      void el.offsetHeight // apply the jump before the spin starts
      const ms = 900 + i * 140
      el.style.transition = `transform ${ms}ms cubic-bezier(0.12, 0.8, 0.22, 1.06)`
      el.style.transform = `translateY(${-target * DIGIT_H}em)`
    })
    if (value !== null && prevValue.current !== null && value !== prevValue.current) {
      setDelta({ amount: value - prevValue.current, key: ++spins.current })
    }
    prevText.current = text
    if (value !== null) prevValue.current = value
  }, [text, value])

  return (
    <span className="slot" aria-live="polite" aria-label={value === null ? 'Balance loading' : `Checking balance ${text}`}>
      <span className="slot-window" aria-hidden="true">
        {chars.map((ch, i) =>
          /\d/.test(ch) ? (
            <span className="reel" key={chars.length - i}>
              <span className="strip" ref={(el) => void (strips.current[i] = el)}>
                {Array.from({ length: 30 }, (_, k) => (
                  <span key={k}>{k % 10}</span>
                ))}
              </span>
            </span>
          ) : (
            <span className={`sym ${ch === '$' ? 'sym-dollar' : ''}`} key={`s${chars.length - i}`}>
              {ch}
            </span>
          ),
        )}
      </span>
      {delta && (
        <span key={delta.key} className={`slot-delta ${delta.amount < 0 ? 'down' : 'up'}`} onAnimationEnd={() => setDelta(null)}>
          {delta.amount < 0 ? '−' : '+'}
          {money(Math.abs(delta.amount))}
        </span>
      )}
    </span>
  )
}
