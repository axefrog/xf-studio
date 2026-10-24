// S2's fit-report wire data. S3 supplies these through the world-fit seam.
export interface FitTerm {
  option: string;
  aes: number;
  var: number;
  yield: number;
  raw: number;
  clamped: number;
}
export interface FitReportFit {
  policy: 'world';
  terms: Record<string, FitTerm[]>;
  aim?: { release: 'early' | 'preferred' | 'late'; urgency: number; wouldHold: boolean };
  notFitted: Array<{ part: string; reason: 'later-capability' }>;
}
