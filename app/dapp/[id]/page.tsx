import { DappDetailClient } from "@/components/DappDetailClient"

export default async function DappDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <DappDetailClient id={id} />
}
