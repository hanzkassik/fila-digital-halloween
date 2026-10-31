import { useMemo, useState } from 'react'
import { create } from 'qrcode'

type Props = { eventName: string; slug: string; publicUrl: string; onClose: () => void }

const escapeXml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!)

function makePosterSvg(eventName: string, publicUrl: string) {
  const qr = create(publicUrl, { errorCorrectionLevel: 'H' })
  const size = qr.modules.size
  const quiet = 4
  const qrUnits = size + quiet * 2
  const qrX = 110 + (780 - 780) / 2
  const qrY = 292
  const qrSide = 780
  const module = qrSide / qrUnits
  const center = qrX + qrSide / 2
  const centerY = qrY + qrSide / 2
  const badgeSide = module * 11
  const badgeX = center - badgeSide / 2
  const badgeY = centerY - badgeSide / 2
  const modules: string[] = []

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (qr.modules.get(y, x)) modules.push(`M${x + quiet} ${y + quiet}h1v1h-1z`)
    }
  }

  const title = escapeXml(eventName)
  const url = escapeXml(publicUrl)
  const hrefText = escapeXml(publicUrl.replace(/^https?:\/\//, ''))
  const logo = `<rect x="${badgeX - 5}" y="${badgeY - 5}" width="${badgeSide + 10}" height="${badgeSide + 10}" rx="${module * 1.3}" fill="#4b245e" stroke="#8e57a7" stroke-width="3"/>
    <rect x="${badgeX}" y="${badgeY}" width="${badgeSide}" height="${badgeSide}" rx="${module}" fill="#231329"/>
    <g transform="translate(${center},${centerY})">
      <ellipse cx="0" cy="${module * .38}" rx="${module * 3.55}" ry="${module * 3.15}" fill="#ff9639"/>
      <ellipse cx="-${module * 1.15}" cy="${module * .45}" rx="${module * 2.35}" ry="${module * 2.75}" fill="#ff7e2f"/>
      <ellipse cx="${module * 1.15}" cy="${module * .45}" rx="${module * 2.35}" ry="${module * 2.75}" fill="#ff8d35"/>
      <path d="M-${module * .65} -${module * 2.05} Q-${module * .75} -${module * 3.5} ${module * .05} -${module * 3.45} Q${module * .15} -${module * 2.75} ${module * .7} -${module * 2.35}Z" fill="#568344"/>
      <path d="M${module * .05} -${module * 3.1} Q${module * .85} -${module * 3.8} ${module * 1.4} -${module * 3.05} Q${module * .7} -${module * 2.55} ${module * .05} -${module * 2.7}Z" fill="#74a64b"/>
      <path d="M-${module * 2.05} -${module * .15} L-${module * 1.35} -${module * 1.25} L-${module * .68} -${module * .15}Z M${module * .68} -${module * .15} L${module * 1.35} -${module * 1.25} L${module * 2.05} -${module * .15}Z" fill="#32183c"/>
      <path d="M-${module * 2.25} ${module * .85} L-${module * 1.25} ${module * 1.35} L-${module * .55} ${module * .82} L0 ${module * 1.42} L${module * .65} ${module * .8} L${module * 2.15} ${module * .55} L${module * 1.45} ${module * 2.25} L-${module * 1.55} ${module * 2.25}Z" fill="#32183c"/>
      <path d="M-${module * .15} ${module * 1.43} L${module * .55} ${module * 1.43} L${module * .24} ${module * 1.92}Z" fill="#fff0cc"/>
    </g>`

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1414" role="img" aria-label="QR Code do evento ${title}">
    <title>QR Code — ${title}</title><desc>Escaneie para abrir o evento e entrar na fila.</desc>
    <rect width="1000" height="1414" fill="#fffaf2"/>
    <rect x="28" y="28" width="944" height="1358" rx="38" fill="#21182d" stroke="#7d4db1" stroke-width="4"/>
    <rect x="60" y="58" width="880" height="164" rx="28" fill="#33203e"/>
    <g transform="translate(145 137)">
      <ellipse cy="7" rx="37" ry="34" fill="#ff9639"/><ellipse cx="-12" cy="8" rx="23" ry="29" fill="#ff7e2f"/><ellipse cx="12" cy="8" rx="23" ry="29" fill="#ff8d35"/>
      <path d="M-7 -20Q-8 -39 2 -36Q3 -26 8 -23Z" fill="#568344"/><path d="M2 -33Q13 -41 19 -31Q11 -25 2 -27Z" fill="#74a64b"/>
      <circle cx="-13" cy="2" r="4" fill="#32183c"/><circle cx="13" cy="2" r="4" fill="#32183c"/><path d="M-11 16Q0 27 11 16" fill="none" stroke="#32183c" stroke-width="4" stroke-linecap="round"/>
    </g>
    <text x="550" y="127" text-anchor="middle" fill="#fff4e5" font-family="Arial,sans-serif" font-size="46" font-weight="700">${title}</text>
    <text x="550" y="178" text-anchor="middle" fill="#d9c6e7" font-family="Arial,sans-serif" font-size="24">Aponte a câmera e entre na fila</text>
    <rect x="100" y="282" width="800" height="800" rx="26" fill="#fffaf2"/>
    <svg x="${qrX}" y="${qrY}" width="${qrSide}" height="${qrSide}" viewBox="0 0 ${qrUnits} ${qrUnits}" shape-rendering="crispEdges" aria-hidden="true">
      <rect width="${qrUnits}" height="${qrUnits}" fill="#fffaf2"/><path d="${modules.join('')}" fill="#21152b"/>
    </svg>
    ${logo}
    <text x="500" y="1160" text-anchor="middle" fill="#f2e6f5" font-family="Arial,sans-serif" font-size="18">${hrefText}</text>
    <text x="500" y="1300" text-anchor="middle" fill="#ff963e" font-family="Arial,sans-serif" font-size="20" letter-spacing="1">FILA DIGITAL · ESPECIAL DE HALLOWEEN</text>
    <metadata>${url}</metadata>
  </svg>`
}

export default function EventQrModal({ eventName, slug, publicUrl, onClose }: Props) {
  const [actionError, setActionError] = useState('')
  const { svg, generationError } = useMemo(() => {
    try { return { svg: makePosterSvg(eventName, publicUrl), generationError: '' } }
    catch { return { svg: '', generationError: 'Não foi possível gerar o QR Code para este link. Confira se o slug do evento é curto o suficiente.' } }
  }, [eventName, publicUrl])

  function downloadSvg() {
    if (!svg) return
    const objectUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = `qr-${slug || 'evento'}-halloween.svg`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
  }

  function printA4() {
    if (!svg) return
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      setActionError('O navegador bloqueou a janela de impressão. Permita pop-ups para este site e tente novamente.')
      return
    }
    printWindow.document.open()
    printWindow.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>QR Code — ${escapeXml(eventName)}</title><style>@page{size:A4 portrait;margin:0}html,body{margin:0;width:210mm;height:297mm;background:#fffaf2}svg{display:block;width:210mm;height:297mm}</style></head><body>${svg}</body></html>`)
    printWindow.document.close()
    window.setTimeout(() => { printWindow.focus(); printWindow.print() }, 350)
  }

  return <div className="scrim event-qr-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="modal event-qr-modal" role="dialog" aria-modal="true" aria-labelledby="event-qr-title">
      <header><div><small className="eyebrow">COMPARTILHAR EVENTO</small><h2 id="event-qr-title">QR Code de {eventName}</h2></div><button type="button" onClick={onClose} aria-label="Fechar">×</button></header>
      <p className="modal-description">Escaneie para abrir a página pública e entrar na fila.</p>
      {generationError ? <div className="error">{generationError}</div> : <div className="event-qr-preview" dangerouslySetInnerHTML={{ __html: svg }} />}
      {actionError && <div className="error event-qr-error">{actionError}</div>}
      <div className="modal-actions event-qr-actions"><button type="button" className="secondary" onClick={onClose}>Fechar</button><button type="button" className="secondary" disabled={!svg} onClick={downloadSvg}>Baixar SVG</button><button type="button" className="primary" disabled={!svg} onClick={printA4}>Imprimir A4 / salvar em PDF</button></div>
    </section>
  </div>
}
