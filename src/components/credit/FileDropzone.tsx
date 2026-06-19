'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

const DEFAULT_MATCH = (f: File) => /\.(xlsx|xls)$/i.test(f.name)

interface Props {
  onFiles: (files: File[]) => void
  isLoading: boolean
  /** Accepted file types — defaults to Excel. Pass a wider set for tabs that
   *  also take PDF/images. */
  accept?: string
  match?: (f: File) => boolean
  title?: string
  hint?: string
}

export function FileDropzone({
  onFiles,
  isLoading,
  accept = '.xlsx,.xls',
  match = DEFAULT_MATCH,
  title = 'גרור קבצי Excel לכאן, או לחץ לבחירה',
  hint = 'xlsx, xls',
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [pending, setPending] = useState<File[]>([])

  function addFiles(incoming: File[]) {
    const ok = incoming.filter(match)
    if (!ok.length) return
    setPending(prev => {
      const existing = new Set(prev.map(f => f.name))
      return [...prev, ...ok.filter(f => !existing.has(f.name))]
    })
  }

  function removeFile(idx: number) {
    setPending(prev => prev.filter((_, i) => i !== idx))
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    addFiles(Array.from(e.dataTransfer.files))
  }

  function handleProcess() {
    if (!pending.length) return
    onFiles(pending)
    setPending([])
  }

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={[
          'flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 cursor-pointer transition-colors select-none',
          isDragging
            ? 'border-gold bg-gold/5'
            : 'border-line bg-surface2 hover:border-gold/50 hover:bg-surface2/80',
        ].join(' ')}
      >
        <span className="text-3xl">📂</span>
        <p className="text-sm text-muted-txt text-center">
          {title}
        </p>
        <p className="text-xs text-muted-txt/60">{hint}</p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        className="hidden"
        onChange={e => { addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }}
      />

      {/* Pending file chips */}
      {pending.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {pending.map((f, i) => (
              <div key={f.name} className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm">
                <span>📄</span>
                <span className="text-txt">{f.name}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); removeFile(i) }}
                  className="text-muted-txt hover:text-txt ml-1"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <Button
            onClick={handleProcess}
            disabled={isLoading}
            className="bg-gold text-black hover:bg-gold/90 font-semibold"
          >
            {isLoading ? '⏳ מנתח...' : `🔍 נתח ${pending.length} קובץ${pending.length > 1 ? 'ות' : ''}`}
          </Button>
        </div>
      )}
    </div>
  )
}
