# map_app

This code repository contains web logic (html/css/js) to implement the main map application for the MEMO project ("Digitales Memobuch der Stadt Graz")
Memo collects data for victims from nationalsocialism in Graz in the years ~1930-1945 and displays them in a map application.

## About

### Aim(s)

1. Visualize sepcific **events** for persons: MEMO visualizes different events ("imprisonment", "death") related to victims of nationalism in Graz
2. Visualize different kind of **victim groups** (e.g. via filters and colors on a map): People were prosecuted for different reasons e.g. for being jewish, being communist etc.     
3. Visualize different **event-types**: People had an inital place where they lived (event type "voluntary_residence") - some where force to live in a specific location ("forced_residence") - most collected persons have a "death" event type. 
4. Visualize the connection/direction/process of a person's events: It should be visible and understandable where a person lived at first -> was forced to live later on -> tried to escape -> and finally died at a certain location.
5. Visualize and **size specific places**: Visualize that some places (especially death) where much more important than others: Try to answer the question: In which camp / location did most of the persons from Graz die?          


### Data model

- At core: **Events** expressed via geojson format
- Each event is associated with persons
- Events might point to the same places (represented via ident coordinate pairs)

### Main challenges
1. Overlapping / ident coordinates for lat lon: Might need to be solved at data level - e.g. create unified geojson feature for events at the same place (with follow up issues). Clustering won't solve this problem on high zoom levels.  
2. Different aims of visualization might need to be solved via different map applications (e.g. vizualization of singular person's events on individual person pages)