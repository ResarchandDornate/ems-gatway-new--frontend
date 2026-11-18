/**
 * Mount point only. Every screen under /k is resolved by ScreenRouter, which
 * lives with the app it routes.
 */
import { ScreenRouter } from "@/mobile_app_kunal_backend/ScreenRouter";

export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  return <ScreenRouter slug={slug} />;
}
