import { DappDetailIsland } from "@/components/DappDetailIsland"

export default async function DappDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <DappDetailIsland id={id} />
}
