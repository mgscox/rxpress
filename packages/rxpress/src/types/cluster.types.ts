export type ClusterHashSource = 'x-forwarded-for' | 'remote-address';

export type ClusterConfig = {
  /**
   * Desired worker count. Defaults to the number of logical CPUs when omitted or < 1.
   */
  workers?: number;
  /**
   * Ordered list of headers/connection properties inspected to derive the sticky hash.
   * Defaults to ['x-forwarded-for', 'remote-address'].
   */
  hashSourceOrder?: ClusterHashSource[];
  /**
   * When true (default), automatically restart workers that exit unexpectedly.
   */
  restartOnExit?: boolean;
};
