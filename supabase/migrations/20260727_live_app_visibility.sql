begin;

alter table public.dapps
  add column if not exists app_visibility boolean not null default true;

comment on column public.dapps.app_visibility is
  'Controls whether Marketplace visitors can launch the deployed IPFS app. Frontend source visibility is configured separately.';

commit;

notify pgrst, 'reload schema';
