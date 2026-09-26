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
    const pageText = content.items.map((item) => ('str' in item ? item.str : '')).join('\n')
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
  return fullText.slice(start, endIdx + endTag.length)
}
