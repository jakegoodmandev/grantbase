create type eligibility_type   as enum ('individual','organization','both');
create type grant_status       as enum ('open','closed','rolling');
create type applicant_type     as enum ('individual','organization');
create type application_status as enum ('draft','submitted','under_review','awarded','rejected','withdrawn');
