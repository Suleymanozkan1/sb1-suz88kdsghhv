import { FeatureGate } from "@/components/feature-gate";

/** Package gate for every page of this module (see FeatureGate). */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <FeatureGate feature="comps">{children}</FeatureGate>;
}
