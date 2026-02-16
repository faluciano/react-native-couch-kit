export interface PackageChangelog {
  name: string;
  version: string;
  bump: "major" | "minor" | "patch";
  breaking: string[];
  features: string[];
  migration: string | null;
  security: string[];
  fullChangelog: string;
}

export interface ExtractedChangelog {
  packages: PackageChangelog[];
  hasBreaking: boolean;
  hasSecurity: boolean;
}
