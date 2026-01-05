import { AppExtensionContext } from 'bike/app'
import { InlineDocumentSync } from './inline-sync'

export async function activate(context: AppExtensionContext) {
  console.log('Inlining: Activated')
  const sync = new InlineDocumentSync()
  sync.start()

  const docObserver = bike.observeDocuments(() => {
    sync.scheduleSync()
  })

  const frontmostDocObserver = bike.observeFrontmostDocument(() => {
    sync.scheduleSync()
  })

  context['inlining-documents-observer'] = docObserver
  context['inlining-frontmost-document-observer'] = frontmostDocObserver
  context['inlining-sync'] = {
    dispose: () => sync.dispose()
  }
}
