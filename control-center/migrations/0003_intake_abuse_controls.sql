CREATE TABLE intake_rate_limits (
  window_start INTEGER NOT NULL,
  client_key TEXT NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count > 0),
  PRIMARY KEY (window_start, client_key)
);

CREATE INDEX intake_rate_limits_window_idx ON intake_rate_limits (window_start);
