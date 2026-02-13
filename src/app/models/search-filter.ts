
export interface SearchFilter {
  key: string;
  value: string;
}

export interface SearchConfig {
  name?: string;
  filters: SearchFilter[];
}

export interface FilterOptionGroup {
  groupLabel: string;
  groupPath: string;
  options: Array<{ value: string; label: string }>;
}
