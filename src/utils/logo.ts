import { supabase } from '../lib/supabase'
import type { Contractor } from '../types/cis'

export interface LogoAsset {
  bytes: Uint8Array
  contentType: 'image/png' | 'image/jpeg'
}

// Loads a contractor's uploaded logo from Storage for embedding into a PDF.
// pdf-lib can only embed PNG and JPEG images directly (not SVG or WebP), so
// a logo uploaded in one of those other formats is skipped here rather than
// failing the whole statement — the rest of the document still generates.
export async function loadContractorLogo(
  contractor: Contractor | null | undefined,
): Promise<LogoAsset | null> {
  if (!contractor?.logo_path) return null
  const { data, error } = await supabase.storage.from('cis-logos').download(contractor.logo_path)
  if (error || !data) return null

  const contentType = data.type || guessContentType(contractor.logo_path)
  if (contentType !== 'image/png' && contentType !== 'image/jpeg') return null

  const bytes = new Uint8Array(await data.arrayBuffer())
  return { bytes, contentType }
}

function guessContentType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'png') return 'image/png'
  return ''
}
