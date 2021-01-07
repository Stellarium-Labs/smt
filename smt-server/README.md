# Survey Monitoring Tool Server

This directory contains the code for running a SMT server similar to the
instance at https://smt.stellarium-web.org/p/smt

## Quick start

Make sure docker and docker-compose are installed on your computer.

Get a copy of the access keys granting you access to the geojson data from
the git project at https://github.com/Stellarium-Labs/smt-data . This is a
private git project, you need to ask one of the project admin to give it to you.

The files should be named access_key and access_key.pub, and must be copied
in the smt-server/ directory.

Then:

``` bash
# Get into this directory
cd smt-server

# Single command to run if you want to try/deploy the server locally.
make run
```

This will setup the build env, build a static version of the the frontend (GUI)
and start frontend and backend services on http://localhost:8100

On first start the backend server will clone the data from https://github.com/Stellarium-Labs/smt-data
and populate its internal database from it, this may take a while.
