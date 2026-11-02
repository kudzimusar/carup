/**
 * A live region (role="status", aria-live="polite") is announced only if it is already in the page when its words arrive:
 * one inserted together with its words is usually read by no screen reader. This records the data-testid of every
 * element whose own content changed AFTER it was in the document, from now until stop(). A region rendered with its words
 * from the start never appears here.
 */
export function watchLiveRegions() {
  const spoke = new Set<string>()
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const target = record.target.nodeType === Node.TEXT_NODE ? record.target.parentElement : (record.target as Element)
      const id = target?.getAttribute?.('data-testid')
      if (id) spoke.add(id)
    }
  })
  observer.observe(document.body, { childList: true, characterData: true, subtree: true })
  return { spoke: () => [...spoke], stop: () => observer.disconnect() }
}
