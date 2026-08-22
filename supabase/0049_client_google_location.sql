alter table public.clients
  add column if not exists google_place_id text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists maps_url text;

alter table public.clients drop constraint if exists clients_latitude_range;
alter table public.clients add constraint clients_latitude_range check (latitude is null or (latitude between -90 and 90));
alter table public.clients drop constraint if exists clients_longitude_range;
alter table public.clients add constraint clients_longitude_range check (longitude is null or (longitude between -180 and 180));
alter table public.clients drop constraint if exists clients_maps_url_bounds;
alter table public.clients add constraint clients_maps_url_bounds check (maps_url is null or length(maps_url) <= 2000);
alter table public.clients drop constraint if exists clients_google_place_id_bounds;
alter table public.clients add constraint clients_google_place_id_bounds check (google_place_id is null or length(google_place_id) <= 500);
