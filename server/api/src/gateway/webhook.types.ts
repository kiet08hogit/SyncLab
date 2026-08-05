export interface GithubReleasePayload {
  action?: string;
  release?: {
    name?: string | null;
    tag_name?: string;
  };
  repository?: {
    id?: number;
    name?: string;
    full_name?: string;
    clone_url?: string;
  };
  installation?: {
    id?: number;
  };
}
