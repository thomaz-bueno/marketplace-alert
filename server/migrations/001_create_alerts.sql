CREATE TABLE IF NOT EXISTS alerts (
  id          SERIAL PRIMARY KEY,
  product_name TEXT           NOT NULL CHECK (length(trim(product_name)) > 0),
  city        TEXT           NOT NULL CHECK (length(trim(city)) > 0),
  max_price   NUMERIC(12, 2) NOT NULL CHECK (max_price >= 0),
  created_at  TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ    NOT NULL DEFAULT now()
);
