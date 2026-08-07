-- Keep the dynamic Dappster Points leaderboard fast without storing a second,
-- drift-prone points balance. One eligible row equals one current point.
create index if not exists dapps_dappster_points_idx
  on public.dapps(owner_id, created_at desc)
  where is_listed = true
    and deploy_status = 'live'
    and contract_address is not null
    and (ipfs_hash is not null or ipfs_url is not null);
