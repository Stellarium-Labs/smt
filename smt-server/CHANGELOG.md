# Changelog

## [0.5.0] - 2021-05-05
- Enable multiple git branches to be used on data server
- Redirect HTTP -> HTTPS

## [0.4.1] - 2021-04-14
- Fix bug when adding comma-separated constraints
- Fix missing server info after data update
- Core performance optimizations

## [0.4.0] - 2021-04-01
- Large server code refactoring
- Use master data branch instead of datav01
- Properly display and track server status on client side
- Allow to load data while serving requests using a DB swap
- Poll the git server every hours and reload data if necessary
- Performance optimizations on core rendering
- Fix missing stars/DSO labels

## [0.3.5] - 2021-03-21
- Fix display issues in analyze panel
- Avoid cache misses when only the order of query constraints was changed
- Fix interlaced query and responses when fast clicking in the GUI
- Add layer rename/save/load features

## [0.3.4] - 2021-03-15
- Improve the computation of the area of the union of footprints
- Add an aggregation operator to compute the cumulative histogram of the area of the union of footprints
- Fix some missing background data (stars and images)
- Add a simple test script to optimize engine performances

## [0.3.3] - 2021-03-11
- Fix several analysis panel bugs causing data to be missed
- Add free text search functionality to tags widget
- Enable Patch ID and Observation ID search
- Add some date range presets such as "Last 30 days"

## [0.3.2] - 2021-03-10
- Add inital analysis panel
- Enable multiple selection in an area (right click)
- Animate fit to view
- The engine can now process multiple aggregations in a single query
- Add MIN, MAX and GROUP_BY_DATE aggregation operation

## [0.3.1] - 2021-03-08
- Add bounding cap aggregation to get the bounding cap for a layer
- Add a switch button to auto-fit the view to the layer's content
- Fix an issue with slow area computation queries being interlaced
- Minor layer re-styling

## [0.3.0] - 2021-03-08
- Refactor engine aggregations to prepare for time histogram computation
- Load geojson files in parallel using web workers
- Improve spatial union aggregation function
- Compute and display the area covered by a layer

## [0.2.3] - 2021-01-22
- Improve selection highlight
- Hide unused part of Stellarium web GUI
- Show more stars and DSO in SMT
- Allow to re-order layers by doing drag and drop on the tab headers
- Large footprints such as survey envelops are now properly split into healpix tiles like any other footprint.

## [0.2.2] - 2021-01-20
- Split internal database in 2 tables, one is optimized for geometry query
- Highlight currently displayed selected footprint
- Remove unused GUI elements
- Enable Gaia catalog and DSS images when zooming

## [0.2.1] - 2021-01-15
- Show colors in histogram to match the sky content
- Fix number range sort order when some values are negative
- Add inline fields description when available in the smtConfig.json file
- Various styling improvements
- Improve server performances for standard queries

## [0.2.0] - 2021-01-14
- Add support for multiple layers
- Display performance improvements
- Allow to assign color to a specific field, including for dates and numbers
- Allow to specify layer opacity

## [0.1.2] - 2021-01-8
- Add doc, and made quick start easier
- Fix following data change
- Change deploy to procedure (faster server)

## [0.1.1] - 2021-01-5
- Improve worker pool to avoid CPU-expensive polling
- A single NGINX is now used to serve the static files and to proxy API access
- Fix saved hash reload bug causing DB to always be re-generated
- Fix scroll bar not visible on firefox

## [0.1.0] - 2021-01-4
- Use workers to speed up queries computations
- API cleanup and code refactoring
- User file-based SQLite data base instead of memory-based
- Don't reload DB when nothing has changed

## [0.0.9] - 2021-01-3
- Fix date range slider disalignement when scroll bar appears
- Fix histograms tooltip blinking bug
- Only pass fieldId in server API instead of the full field definition

## [0.0.8] - 2020-12-16
- Fix date range bug when range is too small
- Fix invalid number of results caused by sub-features (features splitted on the healpix grid)
- Fix footprint display performance regression

## [0.0.7] - 2020-12-15
- Use SQLite as a primary DB engine

## [0.0.6] - 2020-12-03
- Run the node server behind a nginx frontend
- Enable server-side caching and gzip compression
- Fix some docker issues
- Change API to use a /api/v1/ prefix
- Add cache-friendly GET query methods

## [0.0.5] - 2020-11-27
- Fix selection issues
- Properly invalidate client cache when the server code was modified

## [0.0.4] - 2020-11-27
- Render the sky with 2 levels of details (LOD)
- In LOD 0: the boundaries of the features displayed are aligned on the healpix grid
- In LOD 1: displayed features are now the real geospatial union of the groupped features
- Improve polygon pre-processing at load time, deal with more corner cases
- Dispay progress bars while loading geojson data

## [0.0.3] - 2020-11-20
- Add version and Changelog file
- Show info about SMT server in the GUI
- Enable client-side caching of tile data

## [0.0.2] - 2020-11-19
- Footprints are cut precisely on healpix pixels boundaries
- Switch to data_01 branch from smt-data project
- Fix aggregation for string fields in spatial queries
- Fix footprint colors function with updated aggregation function

## [0.0.1] - 2020-11-17

- First deployed version on test dev server [smt-frontend](https://smt-frontend.stellarium-web.org/)
- Data files are now stored on [smt-data github project](https://github.com/Stellarium-Labs/smt-data)
- Official code repo is now on [smt github project](https://github.com/Stellarium-Labs/smt)
