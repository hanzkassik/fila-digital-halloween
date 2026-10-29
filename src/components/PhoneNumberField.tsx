import PhoneInput, { getCountries, getCountryCallingCode, type Country } from 'react-phone-number-input'
import { useEffect, useMemo, useRef, useState, type FocusEvent } from 'react'
import countryNames from 'react-phone-number-input/locale/pt-BR.json'
import { appAsset } from '../lib/paths'

type Option = { value?: string; label: string }
type CountrySelectProps = {
  value?: string
  onChange: (value?: string) => void
  options: Option[]
  name?: string
  disabled?: boolean
  readOnly?: boolean
  tabIndex?: number
  className?: string
  onFocus?: (event: FocusEvent<HTMLElement>) => void
  onBlur?: (event: FocusEvent<HTMLElement>) => void
}

const labels: Record<string, string> = { ...countryNames, country: 'País', phone: 'Telefone' }
for (const country of getCountries()) {
  const code = country as Country
  labels[code] = countryNames[code] + ' (+' + getCountryCallingCode(code) + ')'
}

function normalize(text: string) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR')
}

function CountrySelect({ value, onChange, options, disabled, readOnly, tabIndex, className, onFocus, onBlur }: CountrySelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const countries = useMemo(() => options
    .filter((option) => option.value && option.value.length === 2)
    .map((option) => ({
      code: option.value as Country,
      name: countryNames[option.value as Country] ?? option.label,
      callingCode: getCountryCallingCode(option.value as Country),
    })), [options])
  const selected = countries.find((country) => country.code === value)
  const filtered = countries.filter((country) => normalize(country.name + ' ' + country.callingCode + ' ' + country.code).includes(normalize(search)))

  useEffect(() => {
    if (!open) return
    function closeOnOutsideClick(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() }
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return <div ref={root} className={(className ?? 'PhoneInputCountry') + ' phone-country-select' + (open ? ' is-open' : '')}>
    <button
      ref={trigger}
      type="button"
      className="phone-country-trigger"
      aria-label={selected ? selected.name + ', código +' + selected.callingCode : 'Escolher país'}
      aria-haspopup="listbox"
      aria-expanded={open}
      disabled={disabled || readOnly}
      tabIndex={tabIndex}
      onFocus={(event) => onFocus?.(event)}
      onBlur={(event) => onBlur?.(event)}
      onClick={() => { setSearch(''); setOpen((current) => !current) }}
    >
      {selected && <img className="country-flag" src={appAsset('flags/' + selected.code + '.svg')} alt="" />}
      <span className="phone-country-label">{selected ? selected.name + ' (+' + selected.callingCode + ')' : 'Escolha o país'}</span>
      <span className="phone-country-chevron" aria-hidden="true" />
    </button>
    {open && <div className="country-picker">
      <input
        className="country-search"
        type="search"
        autoFocus
        aria-label="Buscar país ou DDI"
        placeholder="Buscar país ou DDI"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="country-options" role="listbox" aria-label="Países">
        {filtered.length ? filtered.map((country) =>
          <button
            key={country.code}
            type="button"
            role="option"
            aria-selected={country.code === value}
            className={'country-option ' + (country.code === value ? 'selected' : '')}
            onClick={() => { onChange(country.code); setOpen(false); trigger.current?.focus() }}
          >
            <img className="country-flag" src={appAsset('flags/' + country.code + '.svg')} alt="" />
            <span>{country.name}</span>
            <small>+{country.callingCode}</small>
          </button>
        ) : <p className="country-empty">Nenhum país encontrado.</p>}
      </div>
    </div>}
  </div>
}

type Props = { value?: string; onChange: (value?: string) => void }

export default function PhoneNumberField({ value, onChange }: Props) {
  return <div className="phone-field">
    <PhoneInput
      international={false}
      defaultCountry="BR"
      addInternationalOption={false}
      labels={labels}
      countrySelectComponent={CountrySelect}
      countrySelectProps={{ 'aria-label': 'País' }}
      value={value}
      onChange={onChange}
      type="tel"
      autoComplete="tel"
      placeholder="(11) 99999-9999"
    />
  </div>
}

