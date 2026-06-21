-- Lowercase all existing market tags
UPDATE markets
SET tags = (
  SELECT array_agg(lower(t))
  FROM unnest(tags) AS t
)
WHERE tags IS NOT NULL AND array_length(tags, 1) > 0;

-- Lowercase featured tags in guild settings
UPDATE guild_settings
SET featured_tags = (
  SELECT array_agg(lower(t))
  FROM unnest(featured_tags) AS t
)
WHERE featured_tags IS NOT NULL AND array_length(featured_tags, 1) > 0;
