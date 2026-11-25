import { requireSupabase } from '../../../services/api.js'

const BUCKET = 'customer-service-photos'
const LINK_SECONDS = 3600

// The photos that came in the customer's email, as the reduced WebP copies the server
// stores (decided 25 Nov 2026), with short-lived signed links. Only ADMIN and SCHEDULING
// can read them: the table and the bucket both check the role.
export async function listRequestPhotos(requestId) {
  const client = await requireSupabase()
  const { data, error } = await client.from('service_request_photos')
    .select('id, original_filename, width, height, size_bytes, object_path')
    .eq('request_id', requestId)
    .eq('status', 'STORED')
    .order('id')
  if (error) throw new Error('The photos from the email could not be loaded.', { cause: error })
  if (!data.length) return []
  const { data: links, error: linkError } = await client.storage.from(BUCKET)
    .createSignedUrls(data.map((photo) => photo.object_path), LINK_SECONDS)
  if (linkError) throw new Error('The photos from the email could not be opened.', { cause: linkError })
  const urlByPath = new Map(links.filter((link) => !link.error && link.signedUrl).map((link) => [link.path, link.signedUrl]))
  return data.filter((photo) => urlByPath.has(photo.object_path)).map((photo) => ({
    id: photo.id,
    name: photo.original_filename,
    width: photo.width,
    height: photo.height,
    sizeBytes: photo.size_bytes,
    url: urlByPath.get(photo.object_path),
  }))
}
