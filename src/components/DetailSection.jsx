import React from 'react'

export default function DetailSection({ title, description, children, id }) {
  return (
    <details className="detailSection" id={id}>
      <summary>
        <span><strong>{title}</strong>{description ? <small>{description}</small> : null}</span>
        <span className="detailSectionIcon" aria-hidden="true">+</span>
      </summary>
      <div className="detailSectionBody">{children}</div>
    </details>
  )
}
