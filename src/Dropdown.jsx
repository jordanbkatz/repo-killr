import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

export default function Dropdown({ label, value, options, onChange, icon }) {
  const id = useId()
  const root = useRef(null)
  const trigger = useRef(null)
  const [open, setOpen] = useState(false)
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  )
  const [activeIndex, setActiveIndex] = useState(selectedIndex)
  const typed = useRef({ text: '', at: 0 })

  useEffect(() => {
    if (!open) return
    const dismiss = (event) => {
      if (!root.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])

  useEffect(() => {
    if (open)
      document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex, id])

  function choose(index) {
    onChange(options[index].value)
    setOpen(false)
    trigger.current?.focus()
  }

  function onKeyDown(event) {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((current) => {
        if (event.key === 'Home') return 0
        if (event.key === 'End') return options.length - 1
        if (!open) return selectedIndex
        return (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
      })
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (open) choose(activeIndex)
      else {
        setActiveIndex(selectedIndex)
        setOpen(true)
      }
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
      }
    } else if (event.key === 'Tab') {
      setOpen(false)
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const time = Date.now()
      typed.current = {
        text: (time - typed.current.at < 600 ? typed.current.text : '') + event.key.toLowerCase(),
        at: time,
      }
      const index = options.findIndex((option) =>
        option.label.toLowerCase().startsWith(typed.current.text),
      )
      if (index !== -1) {
        event.preventDefault()
        setActiveIndex(index)
        setOpen(true)
      }
    }
  }

  return (
    <div
      ref={root}
      className="custom-select"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      <button
        ref={trigger}
        type="button"
        className={`sort-select ${open ? 'is-open' : ''}`}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? `${id}-listbox` : undefined}
        aria-activedescendant={open ? `${id}-option-${activeIndex}` : undefined}
        onKeyDown={onKeyDown}
        onClick={() => {
          setActiveIndex(selectedIndex)
          setOpen((previous) => !previous)
        }}
      >
        {icon}
        <span className="dropdown-value">{options[selectedIndex].label}</span>
        <ChevronDown size={16} className="dropdown-chevron" />
      </button>
      {open && (
        <div id={`${id}-listbox`} className="dropdown-menu" role="listbox" aria-label={label}>
          {options.map((option, index) => (
            <div
              key={option.value}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={option.value === value}
              className={`dropdown-option ${index === activeIndex ? 'is-active' : ''}`}
              onPointerMove={() => setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
            >
              <span>{option.label}</span>
              {option.value === value && <Check size={17} />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
