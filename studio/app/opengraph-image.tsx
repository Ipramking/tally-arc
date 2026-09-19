import { ImageResponse } from "next/og";
import { OgCard, ogSize, ogAlt, ogContentType } from "@/lib/og-card";

export const runtime = "edge";
export const alt = ogAlt;
export const size = ogSize;
export const contentType = ogContentType;

export default function OpengraphImage() {
  return new ImageResponse(<OgCard />, { ...ogSize });
}
