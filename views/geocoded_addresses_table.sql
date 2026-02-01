-- =============================================================================
-- geocoded_addresses table
-- Stores geocoded lat/long for advisors without SFDC coordinates
-- Location: savvy-gtm-analytics.Tableau_Views (northamerica-northeast2)
-- =============================================================================

CREATE TABLE IF NOT EXISTS `savvy-gtm-analytics.Tableau_Views.geocoded_addresses` (
  primary_key STRING NOT NULL,
  address_input STRING,          -- The address string sent to geocoder
  lat FLOAT64,
  lng FLOAT64,
  geocode_accuracy STRING,       -- e.g., 'ROOFTOP', 'RANGE_INTERPOLATED', 'GEOMETRIC_CENTER', 'APPROXIMATE'
  geocode_source STRING,         -- e.g., 'google'
  geocoded_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
OPTIONS (
  description = 'Geocoded coordinates for joined advisors map'
);
