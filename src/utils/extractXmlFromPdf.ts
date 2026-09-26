// Some CIS software (and this app's own historical exports) produces a PDF
// "printout" of the CIS300 GovTalk XML rather than the raw .xml file itself
// — the text is still there, just laid out as a monospace listing across
// pages. This extracts the page text with pdf.js and pulls out the
// <GovTalkMessage>...</GovTalkMessage> substring so it can go through the
// same parser as a real .xml file.
import * as pdfjsLib from 'pdfjs-dist'
// Vite bundles the worker as its own asset and gives us a URL for it.
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.js?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc

export async function extractXmlFromPdf(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
  let fullText = ''
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    // pdf.js splits text into a run per style change (e.g. a tag rendered in
    // one colour, its value in another/bold), not per visual line — joining
    // every item with a newline would inject whitespace into the middle of
    // tags whenever the PDF colour-codes XML. Each item instead reports
    // whether a real line break follows it (hasEOL), so only insert a
    // newline there and concatenate everything else directly, reconstructing
    // each line's characters exactly as shown.
    let pageText = ''
    for (const item of content.items) {
      if (!('str' in item)) continue
      pageText += item.str
      if ('hasEOL' in item && item.hasEOL) pageText += '\n'
    }
    fullText += pageText + '\n'
  }

  const start = fullText.indexOf('<GovTalkMessage')
  const endTag = '</GovTalkMessage>'
  const endIdx = fullText.indexOf(endTag)
  if (start === -1 || endIdx === -1) {
    throw new Error(
      'Could not find a CIS300 XML submission inside this PDF. It needs to contain the ' +
        'full <GovTalkMessage>...</GovTalkMessage> text, as HMRC submission-confirmation ' +
        'printouts do.',
    )
  }
  const xml = fullText.slice(start, endIdx + endTag.length)
  // Belt and braces: if a stray line break still landed inside a tag (a
  // style/colour run boundary pdf.js reported as hasEOL when it shouldn't
  // have), collapse it to a single space rather than let it break parsing.
  return xml.replace(/<[^>]*>/gs, (tag) => tag.replace(/\s*\n\s*/g, ' '))
}
