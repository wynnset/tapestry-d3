(function(){

/****************************************************
 * CONSTANTS AND GLOBAL VARIABLES
 ****************************************************/



const // declared
    TAPESTRY_CONTAINER_ID = "tapestry",
    PROGRESS_THICKNESS = (20/1.5),  // RM /100 - ford
    LINK_THICKNESS = 6,
    NORMAL_RADIUS = (140/1.5),  //140 originally
    ROOT_RADIUS_DIFF = (70/1.5), //70 originally
    GRANDCHILD_RADIUS_DIFF = (-100/1.5), //-100 originally
    TRANSITION_DURATION = 800,
    COLOR_STROKE = "#072d42",
    COLOR_GRANDCHILD = "#CCC",
    COLOR_LINK = "#999",
    COLOR_SECONDARY_LINK = "transparent",
    CSS_OPTIONAL_LINK = "stroke-dasharray: 30, 15;",
    FONT_ADJUST = 1.25;

const // calculated
    MAX_RADIUS = NORMAL_RADIUS + ROOT_RADIUS_DIFF + 30,     // 30 is to count for the icon
    INNER_RADIUS = NORMAL_RADIUS - (PROGRESS_THICKNESS / 2),
    OUTER_RADIUS = NORMAL_RADIUS + (PROGRESS_THICKNESS / 2);

var dataset, root, svg, links, nodes,               // Basics
    path, pieGenerator, arcGenerator,               // Donut
    simulation,                                     // Force
    tapestrySlug, saveProgressToCookie = true,      // Cookie
    nodeImageHeight = (420/1.5),
    nodeImageWidth = (780/1.5),
    rootNodeImageHeightDiff = (70/1.5),
    h5pVideoSettings = {},
    locn = 2                                       // default slider input

/****************************************************
 * INITIALIZATION
 ****************************************************/


/* Import data from json file, then start D3 */

jQuery.get(apiUrl + "/tapestries/" + tapestryWpPostId, function(result){
    dataset = result;

    //---------------------------------------------------
    // 1. GET PROGRESS FROM COOKIE (IF ENABLED)
    //---------------------------------------------------

    tapestrySlug = dataset.settings.tapestrySlug;
    
    if (saveProgressToCookie) {
        // Update dataset with data from cookie (if any)
        var cookieProgress = Cookies.get("progress-data-"+tapestrySlug);
        if (cookieProgress !== undefined) {
            cookieProgress = JSON.parse( cookieProgress );
            setDatasetProgress(cookieProgress);
        }
        // Update H5P Video Settings from cookie (if any)
        var cookieH5PVideoSettings = Cookies.get("h5p-video-settings");
        if (cookieH5PVideoSettings !== undefined) {
            cookieH5PVideoSettings = JSON.parse( cookieH5PVideoSettings );
            h5pVideoSettings = cookieH5PVideoSettings;
        }
    }

    //---------------------------------------------------
    // 2. SIZE AND SCALE THE TAPESTRY AND SVG TO FIT WELL
    //---------------------------------------------------


    // establish initial positioning before the startforce()
    // this so 'getNodeDimensions' is operational at this stage
    for (var index in dataset.nodes) {
        if (dataset.nodes[index].x == null) {
            dataset.nodes[index].x = getBrowserWidth();
        }
        if (dataset.nodes[index].y == null) {
            dataset.nodes[index].y = getBrowserHeight();
        }
    }

    function updateTapestrySize() {

        var nodeDimensions = getNodesDimensions(dataset);
    
        // Transpose the tapestry so it's longest side is aligned with the longest side of the browser
        // For example, vertically long tapestries should be transposed so they are horizontally long on desktop,
        // but kept the same way on mobile phones where the browser is vertically longer
        var tapestryAspectRatio = nodeDimensions['x'] / nodeDimensions['y'];
        var windowAspectRatio = getAspectRatio();
        if (tapestryAspectRatio >= 1 && windowAspectRatio <= 1 || tapestryAspectRatio <= 1 && windowAspectRatio >= 1) {  /// ORIGINAL VALUE = 1 - ford
            transposeNodes();
        }
        
        // Update svg dimensions to the new dimensions of the browser
        updateSvgDimensions(TAPESTRY_CONTAINER_ID);
        console.log(getTapestryDimensions());
    }

    // do it now - ford
    updateTapestrySize();
    // also do it whenever window is resized
    $(window).resize(function(){
        updateTapestrySize();
    });
        
    //---------------------------------------------------
    // 3. SET NODES/LINKS AND CREATE THE SVG OBJECTS
    //---------------------------------------------------
    
    root = dataset.rootId,
    
    setNodeTypes(dataset.rootId);
    setLinkTypes(dataset.rootId);

    if (dataset.settings !== undefined && dataset.settings.thumbDiff !== undefined) {
        nodeImageHeight += dataset.settings.thumbDiff;
        rootNodeImageHeightDiff += dataset.settings.thumbDiff;
    }
    if (dataset.settings !== undefined && dataset.settings.thumbRootDiff !== undefined) {
        rootNodeImageHeightDiff += dataset.settings.thumbRootDiff;
    }
    
    svg = createSvgContainer(TAPESTRY_CONTAINER_ID); 
    links = createLinks();
    nodes = createNodes();
    
    filterLinks();

    buildNodeContents();
    resizeNodes(root);

    
    //---------------------------------------------------
    // 4. START THE FORCED GRAPH
    //---------------------------------------------------

    startForce();

    recordAnalyticsEvent('app', 'load', 'tapestry', tapestrySlug);
});

/****************************************************
 * D3 SLIDER FUNCTIONALITY
 ****************************************************/

var slider = document.getElementById("myRange");

slider.onchange = function() {
    locn = this.value;

    getChildrenRec(root,locn);

    setNodeTypes(root);
    setLinkTypes(root);
    filterLinks();

    rebuildNodeContents();

};

/****************************************************
 * D3 RELATED FUNCTIONS
 ****************************************************/

/* Define forces that will determine the layout of the graph */
function startForce() {

    var nodes = dataset.nodes
    var tapestryDimensions = getTapestryDimensions();

    collideForce = d3.forceCollide(
        function (d) {
            return getRadius(d) * 1.5;
        });

    simulation = d3.forceSimulation(nodes)

        // "charge" and forceManyBody determine the the repulsion/attraction strength
        .force("charge", d3.forceManyBody().strength(-4000))

        // establish links, the function sets IDs as endpoints, rather than indexes
        .force("link", d3.forceLink(dataset.links).id(function(d) {
            return d.id
        }))

        // slow down the nodes from spinning
        .velocityDecay(0.99)

        // "center" determines where the center of gravity is
        .force("center", d3.forceCenter()
            .x(tapestryDimensions['width'] / 2)
            .y(tapestryDimensions['height'] / 2))

        // determines the minimum distance that nodes are allowed to be positioned at
        .force("collision", d3.forceCollide().radius(function (d) {
            if (root === d.id) {
                return MAX_RADIUS
            }
            else {
                return (MAX_RADIUS - 25)
            }
        }));

    simulation
        .nodes(dataset.nodes)
        .on("tick",ticked)
    
}

//Resize all nodes, where id is now the root
function resizeNodes(id) {
    getChildrenRec(id,locn);

    setNodeTypes(id);
    setLinkTypes(id);
    filterLinks();

    rebuildNodeContents();
}

function ticked() {
    var tapestryDimensions = getTapestryDimensions();
    links
        .attr("x1", function (d) {
            return getBoundedCoord(d.source.x, tapestryDimensions['width']);
        })
        .attr("y1", function (d) {
            return getBoundedCoord(d.source.y, tapestryDimensions['height']);
        })
        .attr("x2", function (d) {
            return getBoundedCoord(d.target.x, tapestryDimensions['width']);
        })
        .attr("y2", function (d) {
            return getBoundedCoord(d.target.y, tapestryDimensions['height']);
        });
    nodes
        .attr("cx", function (d) {
            return getBoundedCoord(d.x, tapestryDimensions['width']);
        })
        .attr("cy", function (d) {
            return getBoundedCoord(d.y, tapestryDimensions['height']);
        })
        .attr("transform", function (d) {
            return "translate(" + getBoundedCoord(d.x, tapestryDimensions['width']) + "," + getBoundedCoord(d.y, tapestryDimensions['height']) + ")";
        });
}

function dragstarted(d) {
    var tapestryDimensions = getTapestryDimensions();
    if (!d3.event.active) simulation.alphaTarget(0.2).restart();
    
    d.x = getBoundedCoord(d.x, tapestryDimensions['width']);
    d.y = getBoundedCoord(d.y, tapestryDimensions['height']);

    recordAnalyticsEvent('user', 'drag-start', 'node', d.id, {'x': d.x, 'y': d.y});
}

function dragged(d) {
    d.x = d3.event.x;
    d.y = d3.event.y;
}

function dragended(d) {
    if (!d3.event.active) simulation.alphaTarget(0);
        
    // Uncomment the line below to get the node positions saved into the container
    // and then copy over to json file to have updated coordinates
    // $('#h5p-log').text(JSON.stringify(dataset.nodes));

    recordAnalyticsEvent('user', 'drag-end', 'node', d.id, {'x': d.x, 'y': d.y});
}

function createSvgContainer(containerId) {
    var tapestryDimensions = getTapestryDimensions();
    return d3.select("#"+containerId)
                .append("svg:svg")
                .attr("id", containerId+"-svg")
                .attr("viewBox", "-20 -20 " + (tapestryDimensions['width']+MAX_RADIUS) + " " + (tapestryDimensions['height']+MAX_RADIUS)) // rm +20 - ford
                .attr("preserveAspectRatio", "xMidYMid meet")
                .append("svg:g")
                .attr("transform", "translate(-20, -20)");
                
}

function updateSvgDimensions(containerId) {
    var tapestryDimensions = getTapestryDimensions();
    d3.select("#"+containerId+"-svg")
        .attr("viewBox", "0 0 " + (tapestryDimensions['width']+MAX_RADIUS) + " " + (tapestryDimensions['height']+MAX_RADIUS)); // rm +20 - ford
    startForce();
}

function createLinks() {
    /* Need to remove old links when redrawing graph */
    return svg.append("svg:g")
                .attr("class", "links")
                .selectAll("line")
                .data(dataset.links)
                    .enter()
                    .append("line")
                    .attr("stroke", function (d) {
                        if (d.type === "grandchild") 
                            return COLOR_GRANDCHILD;
                        else if (d.secondary)
                            return COLOR_SECONDARY_LINK;
                        else return COLOR_LINK;
                    })
                    .attr("style", function(d){
                        if (d.type === "") 
                            return "display: none"
                        else if (d.optional)
                            return CSS_OPTIONAL_LINK;
                        else return "";
                    })
                    .attr("stroke-width", LINK_THICKNESS);
}

function createNodes() {
    /* Need to remove old nodes when redrawing graph */
    return svg.selectAll("g.node")
                .data(dataset.nodes)
                .enter()
                .append("svg:g")
                    .attr("class", "node")
                    .attr("id", function (d) {
                        return "node-" + d.id;
                    });
}

// TODO: Get rid of this function (use buildNodeContents and rebuildNodeContents instead)
function filterLinks() {
    var linksToHide = links.filter(function (d) {
        var sourceId, targetId;
        if (typeof d.source === 'number' && typeof d.target === 'number') {
            sourceId = d.source;
            targetId = d.target;
        } else if (typeof d.source === 'object' && typeof d.target === 'object') {
            sourceId = d.source.id;
            targetId = d.target.id;
        }

        var shouldRender = false;
        if (sourceId === root || targetId === root) {
            shouldRender = true;
        } else if (getChildrenRec(root,locn-1).indexOf(sourceId) > -1 || getChildrenRec(root,locn-1).indexOf(targetId) > -1) {
            shouldRender = true;
        }
        return !shouldRender;
    });

    var linksToShow = links.filter(function (d) {
        var sourceId, targetId;
        if (typeof d.source === 'number' && typeof d.target === 'number') {
            sourceId = d.source;
            targetId = d.target;
        } else if (typeof d.source === 'object' && typeof d.target === 'object') {
            sourceId = d.source.id;
            targetId = d.target.id;
        }

        var shouldRender = false;
        if (sourceId === root || targetId === root) {
            shouldRender = true;
        } else if (getChildrenRec(root,locn-1).indexOf(sourceId) > -1 || getChildrenRec(root,locn-1).indexOf(targetId) > -1) {
            shouldRender = true;
        }
        return shouldRender;
    });

    linksToShow
        .style("display", "block");

    linksToHide
        .transition()
        .duration(TRANSITION_DURATION)
        .style("opacity", "0");

    linksToShow
        .transition()
        .duration(TRANSITION_DURATION)
        .style("opacity", "1");
    
    setTimeout(function(){
        linksToHide
            .style("display", "block");
    }, TRANSITION_DURATION);
}

/* Draws the components that make up node */
function buildNodeContents() {
    slider.max = maxDepth(root);
    
    /* Draws the circle that defines how large the node is */
    nodes.append("rect")
        .attr("class", function (d) {
            if (d.nodeType === "grandchild") return "imageContainer expandGrandchildren";
            return "imageContainer";
        })
        .attr("rx", function (d) {
            return getRadius(d);
        })
        .attr("ry", function (d) {
            return getRadius(d);
        })
        .attr("data-id", function (d) {
            return d.id;
        })
        .attr("stroke-width", function (d) {
            return PROGRESS_THICKNESS;
        })
        .attr("stroke", function (d) {
            if (d.nodeType === "") 
                return "transparent";
            else if (d.nodeType === "grandchild") 
                return COLOR_GRANDCHILD;
            else return COLOR_STROKE;
        })
        .attr("width", function (d) {
            if (d.nodeType === "") return 0;
            return getRadius(d) * 2;
        })
        .attr("height", function (d) {
            if (d.nodeType === "") return 0;
            return getRadius(d) * 2;
        })
        .attr("x", function (d) {
            return - getRadius(d);
        })
        .attr("y", function (d) {
            return - getRadius(d);
        })
        .attr("fill", function (d) {
            return "url('#node-thumb-" + d.id + "')";
        });

    nodes.append("circle")
        .attr("class", "imageOverlay")
        .attr("data-id", function (d) {
            return d.id;
        })
        .attr("stroke-width", function () {
            return PROGRESS_THICKNESS;
        })
        .attr("r", function (d) {
            var rad = getRadius(d);
            if (rad > PROGRESS_THICKNESS/2)
                return rad - PROGRESS_THICKNESS/2;
            else
                return 0;
        })
        .attr("fill", function (d) {
            if (d.nodeType === "") 
                return "transparent";
            else if (d.nodeType === "grandchild") 
                return COLOR_GRANDCHILD;
            else return COLOR_STROKE;
        });

    /* Attach images to be used within each node */
    nodes.append("defs")
        .append("pattern")
        .attr("id", function (d) {
            return "node-thumb-" + d.id;
        })
        .attr("data-id", function (d) {
            return d.id;
        })
        .attr("pattenUnits", "userSpaceOnUse")
        .attr("height", 1)
        .attr("width", 1)
        .append("image")
        .attr("height", function (d) {
            if (d.nodeType === "root") {
                return nodeImageHeight + rootNodeImageHeightDiff;
            } else return nodeImageHeight;
        })
        .attr("width", nodeImageWidth)
        .attr("x", 0)
        .attr("y", 0)
        .attr("preserveAspectRatio", "xMinYMin")
        .attr("xlink:href", function (d) {
            return d.imageURL;
        });

    /* Add path and button */
    buildPathAndButton();

    /* Add dragging and node selection functionality to the node */
    nodes.call(
        d3.drag()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended))
        .on("click", function (d) {
            // prevent multiple clicks
            if (root != d.id) {
                root = d.id;
                resizeNodes(d.id);
                slider.max = maxDepth(root);
                // simulation
                //     .force("collision", d3.forceCollide().radius(function (d) {
                //         if (root === d.id) {
                //             return MAX_RADIUS
                //         }
                //         else {
                //             return (MAX_RADIUS - 25)
                //         }
                //     }));
            }
            recordAnalyticsEvent('user', 'click', 'node', d.id);
        });
}

function rebuildNodeContents() {

    nodes.selectAll(".imageOverlay")
            .transition()
            .duration(TRANSITION_DURATION/2)
            .attr("r", function (d) {
                var rad = getRadius(d);
                if (rad > PROGRESS_THICKNESS/2)
                    return rad - PROGRESS_THICKNESS/2;
                else
                    return 0;
            })
            .attr("fill", function (d) {
                if (d.nodeType === "") 
                    return "transparent";
                else if (d.nodeType === "grandchild") 
                    return COLOR_GRANDCHILD;
                else return COLOR_STROKE;
            });
            
    nodes.selectAll(".imageContainer")
            .attr("class", function (d) {
                if (d.nodeType === "grandchild" || d.nodeType === "") 
                    return "imageContainer expandGrandchildren";
                else return "imageContainer";
            })
            .transition()
            .duration(TRANSITION_DURATION)
            .attr("rx", function (d) {
                return getRadius(d);
            })
            .attr("ry", function (d) {
                return getRadius(d);
            })
            .attr("stroke", function (d) {
                if (d.nodeType === "") 
                    return "transparent";
                else if (d.nodeType === "grandchild") 
                    return COLOR_GRANDCHILD;
                else return COLOR_STROKE;
            })
            .attr("width", function (d) {
                return getRadius(d) * 2;
            })
            .attr("height", function (d) {
                return getRadius(d) * 2;
            })
            .attr("x", function (d) {
                return - getRadius(d);
            })
            .attr("y", function (d) {
                return - getRadius(d);
            })
            .attr("fill", function (d) {
                return "url('#node-thumb-" + d.id + "')";
            });
    
    /* Attach images to be used within each node */
    nodes.selectAll("defs")
            .selectAll("pattern")
            .selectAll("image")
            .transition()
            .duration(TRANSITION_DURATION)
            .attr("height", function (d) {
                if (d.nodeType === "root") {
                    return nodeImageHeight + rootNodeImageHeightDiff;
                } else return nodeImageHeight;
            });

    // Remove elements and add them back in
    nodes.selectAll("text").remove();
    nodes.selectAll(".mediaButton").remove();
    nodes.selectAll("path").remove();
    setTimeout(function(){
        buildPathAndButton();
    }, TRANSITION_DURATION);
    
}

function buildPathAndButton() {

    /* Add progress pie inside each node */
    pieGenerator = d3.pie().sort(null).value(function (d) {
        return d.value;
    });
    arcGenerator = d3.arc().startAngle(0);

    /* Update the progress pies */
    updateViewedProgress();

    nodes
        .filter(function (d) {
            return d.nodeType !== ""
        })
        .append("text")
        .attr("text-anchor", "middle")
        .attr("fill", "white")
        .attr("class", "title")
        .attr("text-anchor", "middle")
        .attr("data-id", function (d) {
            return d.id;
        })
        .text(function (d) {
            return d.title;
        })
        .attr("style", function (d) {
            return d.nodeType === "grandchild" ? "visibility: hidden" : "visibility: visible";
        })
        .call(wrapText, NORMAL_RADIUS * 2);

    nodes
        .filter(function (d) {
            return d.nodeType !== ""
        })
        .append("svg:foreignObject")
        .html(function (d) {
            return '<i id="mediaButtonIcon' + d.id + '"' + 
                ' class="' + getMediaIconClass(d.mediaType, 'play') + ' mediaButtonIcon"' + 
                ' data-id="' + d.id + '"' + 
                ' data-format="' + d.mediaFormat + '"' + 
                ' data-media-type="' + d.mediaType + '"' + 
                ' data-thumb="' + d.imageURL + '"' + 
                ' data-url="' + d.typeData.mediaURL + '"' + 
                ' data-media-width="' + d.typeData.mediaWidth + '"' + 
                ' data-media-height="' + d.typeData.mediaHeight + '"><\/i>';
        })
        .attr("id", function (d) {
            return "mediaButton" + d.id;
        })
        .attr("data-id", function (d) {
            return d.id;
        })
        .attr("width", "60px") // 60px
        .attr("height", "62px") //62px - originals
        .attr("x", -27)
        .attr("y", function (d) {
            return -NORMAL_RADIUS - 30 - (d.nodeType === "root" ? ROOT_RADIUS_DIFF : 0);
        })
        .attr("style", function (d) {
            return d.nodeType === "grandchild" ? "visibility: hidden" : "visibility: visible";
        })
        .attr("class", "mediaButton");

    $('.mediaButton > i').click(function(){
        var thisBtn = $(this)[0];
        setupLightbox(thisBtn.dataset.id, thisBtn.dataset.format, thisBtn.dataset.mediaType, thisBtn.dataset.url, thisBtn.dataset.mediaWidth, thisBtn.dataset.mediaHeight);
        recordAnalyticsEvent('user', 'open', 'lightbox', thisBtn.dataset.id);
    });
}

function updateViewedProgress() {
    path = nodes
        .filter(function (d) {
            return d.nodeType !== ""
        })
        .selectAll("path")
        .data(function (d, i) {
            var data = d.typeData.progress;
            data.forEach(function (e) {
                e.extra = {'nodeType': d.nodeType}
            })
            return pieGenerator(data, i);
        });

    path.transition().duration(750).attrTween("d", arcTween);

    path.enter()
        .append("path")
        .attr("fill", function (d, i) {
            if (d.data.group !== "viewed") return "transparent";
            if (d.data.extra.nodeType === "grandchild" || d.data.extra.nodeType === "") 
                return "#cad7dc";
            else return "#11a6d8";
        })
        .attr("class", function (d) {
            if (d.data.extra.nodeType === "grandchild" || d.data.extra.nodeType === "") 
                return "expandGrandchildren";
        })
        .attr("d", function (d) {
            return arcGenerator(adjustProgressBarRadii(d));
        });
}

function arcTween(a) {
    const i = d3.interpolate(this._current, a);
    this._current = i(1);
    return (t) => {
        return arcGenerator(adjustProgressBarRadii(i(t)))
    };
}

function adjustProgressBarRadii(d) {
    var addedRadius = 0;
    var addedRadiusInner = 0;
    if (d.data.extra.nodeType === "root")
        addedRadius = ROOT_RADIUS_DIFF;
    if (d.data.extra.nodeType === "grandchild") {
        addedRadius = GRANDCHILD_RADIUS_DIFF;
        addedRadiusInner = -1 * (INNER_RADIUS + addedRadius); // set inner radius to 0
    }
    arcGenerator.innerRadius(INNER_RADIUS + addedRadius + addedRadiusInner)(d);
    arcGenerator.outerRadius(OUTER_RADIUS + addedRadius)(d);
    return d;
}

/****************************************************
 * MEDIA RELATED FUNCTIONS
 ****************************************************/

function setupLightbox(id, mediaFormat, mediaType, mediaUrl, width, height) {

    var resizeRatio = 1;
    if (width > getBrowserWidth()) {
        resizeRatio = getBrowserWidth() / width * 0.8;
        width *= resizeRatio;
        height *= resizeRatio;
    }

    // Possibly interfering with the resizer
    if (height > getBrowserHeight() * resizeRatio) {
        resizeRatio *= getBrowserHeight() / height;
        width *= resizeRatio;
        height *= resizeRatio;
    }

    var media = setupMedia(id, mediaFormat, mediaType, mediaUrl, width, height);

    $('<div id="spotlight-overlay"><\/div>').on("click", function(){
        closeLightbox(id, mediaType);
    }).appendTo('body');
    $('<div id="spotlight-content" data-media-format="' + mediaFormat + '"><\/div>').css({
        top: ((getBrowserHeight() - height) / 2) + $(this).scrollTop(),
        left: (getBrowserWidth() - width) / 2,
        width: width,
        height: height,
        opacity: 0
    }).appendTo('body');
    $('#spotlight-content').draggable({
        delay: 10,
        distance: 8
    });

    media.appendTo('#spotlight-content');

    setTimeout(function(){
        $('#spotlight-content').css({
            opacity: 1
        });
    }, 1000);

    var loadEvent = 'load';
    if (mediaFormat == "mp4") {
        loadEvent = "loadstart";
    }

    media.on(loadEvent, function() {
        window.setTimeout(function(){
            height = $('#spotlight-content > *').outerHeight();
            width = $('#spotlight-content > *').outerWidth();

            $('#spotlight-content').css({
                width: width,
                height: height,
                transitionDuration: "0.2s"
            });
        }, 2000);
        window.setTimeout(function(){
            $('#spotlight-content').css({
                transitionDuration: "1s"
            });
        }, 200);
    });
}

function setupMedia(id, mediaFormat, mediaType, mediaUrl, width, height) {

    var buttonElementId = "#mediaButtonIcon" + id;

    // Add the loading gif
    $(buttonElementId).addClass('mediaButtonLoading');

    var index = findNodeIndex(id);
    var viewedAmount;
    var mediaEl;

    if (mediaFormat === "mp4") {

        mediaEl = $('<video id="' + mediaFormat + '" controls><source id="video-source" src="' + mediaUrl + '" type="video/mp4"><\/video>');
        var video = mediaEl[0];

        video.addEventListener('loadedmetadata', function () {
    
            // Update the mediaButton icon to pause icon when video is playing
            video.addEventListener('play', function () {
                updateMediaIcon(id, mediaType, 'pause');
                recordAnalyticsEvent('user', 'play', 'html5-video', id, {'time': video.currentTime});
            });
            // Update the mediaButton icon to play icon when video is paused
            video.addEventListener('pause', function () {
                updateMediaIcon(id, mediaType, 'play');
                recordAnalyticsEvent('user', 'pause', 'html5-video', id, {'time': video.currentTime});
            });
            
            // Update the progress circle for this video
            video.addEventListener('timeupdate', function () {
                if (video.played.length > 0 && viewedAmount < video.currentTime) {
                    updateViewedValue(id, video.currentTime, video.duration);
                    updateViewedProgress();
                }
            });

            // Play the video at the last watched time (or at the beginning if not watched yet)
            // (start from beginning again if person had already viewed whole video)
            viewedAmount = dataset.nodes[index].typeData.progress[0].value * video.duration;
            if (viewedAmount > 0 && viewedAmount !== video.duration) {
                video.currentTime = viewedAmount;
            }
            else {
                video.currentTime = 0;
            }

            // Auto-play
            setTimeout(function(){
                video.play();
                recordAnalyticsEvent('app', 'auto-play', 'html5-video', id);
            }, 1000);

        }, false);
        
    } else if (mediaFormat === "h5p") {

        mediaEl = $('<iframe id="h5p" src="' + mediaUrl + '" width="' + width + '" height="' + height + '" frameborder="0" allowfullscreen="allowfullscreen"><\/iframe>');
        var iframe = mediaEl[0];

        iframe.addEventListener('load', function() {

            var h5pObj = document.getElementById('h5p').contentWindow.H5P;
            var mediaProgress = dataset.nodes[index].typeData.progress[0].value;    // Percentage of the video already watched

            // TODO: support other types of H5P content
            if (mediaType == "video") {

                var h5pVideo = h5pObj.instances[0].video;
                
                var seeked = false;
                var currentPlayedTime;

                h5pVideo.on('stateChange', function (event) {

                    switch (event.data) {
                        case h5pObj.Video.PLAYING:

                            var videoDuration = h5pVideo.getDuration();

                            // Update the progress circle for this video
                            // Done with an interval because H5P does not have a way to continuously check the updated time
                            var updateVideoDuration = setInterval( function () {
                                if (currentPlayedTime != h5pVideo.getCurrentTime() && h5pVideo.getCurrentTime() > 0) {
                                    currentPlayedTime = h5pVideo.getCurrentTime();
                                    updateViewedValue(id, currentPlayedTime, videoDuration);
                                    updateViewedProgress();
                                }
                                else {
                                    clearInterval(updateVideoDuration);
                                }
                            }, 300);
                            
                            if (!seeked) {
                                // Change the video settings to whatever the user had set before
                                if (h5pVideoSettings.volume !== undefined) {
                                    h5pVideo.setVolume(h5pVideoSettings.volume);
                                    if (h5pVideoSettings.muted) h5pVideo.mute(); else h5pVideo.unMute();
                                    h5pVideo.setCaptionsTrack(h5pVideoSettings.caption);
                                    h5pVideo.setQuality(h5pVideoSettings.quality);
                                    h5pVideo.setPlaybackRate(h5pVideoSettings.playbackRate);
                                }
                                // Play the video at the last watched time (or at the beginning if the user has
                                // not watched yet or if the user had already viewed whole video)
                                var viewedAmount = mediaProgress * videoDuration;
                                if (viewedAmount > 0 && viewedAmount !== videoDuration) {
                                    h5pVideo.seek(viewedAmount);
                                }
                                else {
                                    h5pVideo.seek(0);
                                }
                                seeked = true;
                            }

                            // Update the mediaButton icon to pause icon
                            updateMediaIcon(id, mediaType, 'pause');

                            recordAnalyticsEvent('user', 'play', 'h5p-video', id, {'time': h5pVideo.getCurrentTime()});
                            break;

                        case h5pObj.Video.PAUSED:
							
                            // Save the video settings
                            h5pVideoSettings = {
                                'volume': h5pVideo.getVolume(),
                                'muted': h5pVideo.isMuted(),
                                'caption': h5pVideo.getCaptionsTrack(),
                                'quality': h5pVideo.getQuality(),
                                'playbackRate': h5pVideo.getPlaybackRate(),
                                'time': h5pVideo.getCurrentTime()
                            };

                            // Update the mediaButton icon to play icon
                            updateMediaIcon(id, mediaType, 'play');
                            seeked = true;

                            recordAnalyticsEvent('user', 'pause', 'h5p-video', id, {'time': h5pVideo.getCurrentTime()});
                            break;

                        case h5pObj.Video.BUFFERING:

                            // Update the mediaButton icon to loading icon
                            updateMediaIcon(id, mediaType, 'loading');
                            break;
                    }
                });

                // Auto-play
                setTimeout(function(){
                    h5pVideo.play();
                    recordAnalyticsEvent('app', 'auto-play', 'h5p-video', id);
                }, 1000);
            }

        }, false);
    }

    return mediaEl;
}

/****************************************************
 * HELPER FUNCTIONS
 ****************************************************/


// Get width, height, and aspect ratio of viewable region
function getBrowserWidth() {
    return Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
}
function getBrowserHeight() {
    return Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
}
function getAspectRatio() {
    var browserHeight = getBrowserHeight();
    var browserWidth = getBrowserWidth();
    if (browserHeight < 10 ) {
        return 0;
    }
    else {
        return browserWidth / browserHeight;
    }
}

function getNodesDimensions(dataset) {
 //   startForce();
    var maxPointX = 0;
    var maxPointY = 0;
    for (var index in dataset.nodes) {
        
        // save max point so we can calculate our tapestry width and height
        if (dataset.nodes[index].x > maxPointX) {  // BACK TO fx - ford
            maxPointX = dataset.nodes[index].x;
        }
        if (dataset.nodes[index].y > maxPointY) { /// BACK TO fy - ford
            maxPointY = dataset.nodes[index].y;
        }
    }

    return {
        'x': maxPointX + MAX_RADIUS,
        'y': maxPointY + MAX_RADIUS
    };
}

function getTapestryDimensions() {

    var nodeDimensions = getNodesDimensions(dataset);
    var tapestryWidth = nodeDimensions['x'];
    var tapestryHeight = nodeDimensions['y'];

    var tapestryAspectRatio = nodeDimensions['x'] / nodeDimensions['y'];
    var tapestryBrowserRatio = tapestryWidth / getBrowserWidth();

    if (tapestryHeight > getBrowserHeight() && tapestryAspectRatio < 5) {  // this was originally 1 instead of 5 - ford
        tapestryWidth *= tapestryHeight/getBrowserHeight() / tapestryBrowserRatio;
    }
    
    // Work-around for an issue on iPhone that zooms in the tapestry too much
    if (getBrowserWidth() < 600) {
        tapestryHeight *= 1.2;
        tapestryWidth *= 1.2;
    }

    return {
        'width': tapestryWidth,
        'height': tapestryHeight
    };
}

function transposeNodes() {
    for (var index in dataset.nodes) {
        var temp_fx = dataset.nodes[index].y;
        dataset.nodes[index].y = dataset.nodes[index].x;
        dataset.nodes[index].x = temp_fx;
    }
}

// Finds the node index with node ID
function findNodeIndex(id) {
    function helper(obj) {
        return obj.id == id;
    }

    return dataset.nodes.findIndex(helper);
}

function getBoundedCoord(coord, maxCoord) {
    return Math.max(MAX_RADIUS, Math.min(maxCoord - MAX_RADIUS, coord));
}

// add 'depth' parameter recursively to each node
function addDepth(rootId, depth, visitlist) {
    var visited = visitlist;
    visited.push(rootId);

    var depthAt = 0;

    dataset.nodes[findNodeIndex(rootId)].depth = depth;
    var children = getChildrenRec(rootId,1);

    var acc;

    while (depthAt < children.length) {
        for (var childId in children) {
            if (visited.includes(children[childId])) {
                acc = depth;
                if (dataset.nodes[findNodeIndex(children[childId])].depth > acc) {
                    dataset.nodes[findNodeIndex(children[childId])].depth = acc;
                }
                else {
                    depthAt++;
                }
            }
            else {
                acc = depth + 1;
                dataset.nodes[findNodeIndex(children[childId])].depth = acc;
                visited.push(children[childId]);

                addDepth(children[childId],acc,visited);
                depthAt++;
            }
        }
    }
    
}

// return the maximum depth from a given rootId
// return the distance between the rootId and its farthest descendant node

function maxDepth(rootId) {
    addDepth(rootId,0,[]);
    var nodes = dataset.nodes;
    var deep = 0;
    var count;
    for (count = 1; count <= nodes.length; count++) {
        if (dataset.nodes[findNodeIndex(count)].depth > deep) {
            deep = dataset.nodes[findNodeIndex(count)].depth;
        }
    }
    return deep;
}

// find children based on depth: 
// depth = 0 returns node + children, depth = 1 returns node + children + children's children, etc.
function getChildrenRec(id,depth) {
    var children = [];
    var dataLinks = dataset.links;
    for (step = 0; step < depth; step++) {
        for (var linkId in dataLinks) {
            var link = dataLinks[linkId];
            if (typeof link.source === 'number' && link.source === id) {
                children.push(link.target);
                children = children.concat(getChildrenRec(link.target,depth-1));
            }
            else if (typeof link.source === 'object' && link.source.id === id) {
                children.push(link.target.id);
                children = children.concat(getChildrenRec(link.target.id,depth-1));
            }

            if (typeof link.target === 'number' && link.target === id) {
                children.push(link.source);
                children = children.concat(getChildrenRec(link.source,depth-1));
            }
            else if (typeof link.target === 'object' && link.target.id === id) {
                children.push(link.source.id);
                children = children.concat(getChildrenRec(link.source.id,depth-1));
            }
        }
    }
    var rchildren = arrayRemove(children,id);
    return rchildren;
}

// remove any duplicates in an array
function arrayRemove(arr, value) {

    return arr.filter(function(ele){
        return ele != value;
    });
 
 }

function getRadius(d) {
    var nodeDiff;
    if (d.nodeType === "") {
        return 0;
    } else if (d.nodeType === "root") {
        nodeDiff = ROOT_RADIUS_DIFF;
    } else if (d.nodeType === "grandchild") {
        nodeDiff = GRANDCHILD_RADIUS_DIFF;
    } else nodeDiff = 0

    return ((NORMAL_RADIUS + nodeDiff));
}


//Updates the data in the node for how much the video has been viewed
function updateViewedValue(id, amountViewedTime, duration) {
    var amountViewed = amountViewedTime / duration;
    var amountUnviewed = 1.00 - amountViewed;

    var index = findNodeIndex(id);

    //Update the dataset with new values
    dataset.nodes[index].typeData.progress[0].value = amountViewed;
    dataset.nodes[index].typeData.progress[1].value = amountUnviewed;

    if (saveProgressToCookie) {
        var progressObj = JSON.stringify(getDatasetProgress());
        Cookies.set("progress-data-"+tapestrySlug, progressObj);
        Cookies.set("h5p-video-settings", h5pVideoSettings);
    }
}

function getDatasetProgress() {
    
    var progressObj = {};
    
    for (var index in dataset.nodes) {
        var node = dataset.nodes[index];
        progressObj[node.id] = node.typeData.progress[0].value;
    }
    
    return progressObj;
}

function setDatasetProgress(progressObj) {
    
    if (progressObj.length < 1) {
        return false;
    }
    
    for (var id in progressObj) {
        
        var amountViewed = progressObj[id];
        var amountUnviewed = 1.00 - amountViewed;
    
        var index = findNodeIndex(id);
        
        if (index !== -1) {
            //Update the dataset with new values
            dataset.nodes[index].typeData.progress[0].value = amountViewed;
            dataset.nodes[index].typeData.progress[1].value = amountUnviewed;
        }
    
    }
    
    return true;
}

/* For setting the "type" field of nodes in dataset */
function setNodeTypes(rootId) {

    root = rootId;
    var children = getChildrenRec(root,locn-1),
        grandchildren = getChildrenRec(root,locn);

    for (var i in dataset.nodes) {
        var node = dataset.nodes[i];
        var id = node.id;

        //NOTE: If there are any nodes are that fit two roles (ie: root and the grandchild),
        //      should default to being the more senior role
        if (id === root) {
            node.nodeType = "root";
        } else if (children.indexOf(id) > -1) {
            node.nodeType = "child";
        } else if (grandchildren.indexOf(id) > -1) {
            node.nodeType = "grandchild";
        } else {
            node.nodeType = "";
        }
    }
}

/* For setting the "type" field of links in dataset */
function setLinkTypes(rootId) {
    root = rootId;
    var children = getChildrenRec(root,locn-1),
        grandchildren = getChildrenRec(root,locn);

    for (var i in dataset.links) {
        var link = dataset.links[i];
        var targetId = link.target.id;

        if (targetId === root) {
            link.type = "root";
        } else if (children.indexOf(targetId) > -1) {
            link.type = "child";
        } else if (grandchildren.indexOf(targetId) > -1) {
            link.type = "grandchild";
        } else {
            link.type = "";
        }
    }
}

// Wrap function specifically for SVG text
// Found on https://bl.ocks.org/mbostock/7555321
function wrapText(text, width) {
    width /= FONT_ADJUST;
    text.each(function (d) {
        var text = d3.select(this),
            words = text.text().split(/\s+/).reverse(),
            word,
            lines = [],
            currentLine = [],
            lineNumber = 0,
            lineHeight = 1.1 * FONT_ADJUST, // ems
            tspan = text.text(null)
                .append("tspan")
                .attr("class", "line" + d.id)
                .attr("x", 0)
                .attr("y", 0);

        while (word = words.pop()) {
            currentLine.push(word);
            tspan.text(currentLine.join(" "));
            if (tspan.node().getComputedTextLength() > width) {
                currentLine.pop(); // Pop the last word off of the previous line
                lines.push(currentLine);
                tspan.text(currentLine.join(" "));
                currentLine = [word]; // line now becomes a new array
                lineNumber++;
                tspan = text.append("tspan")
                    .attr("class", "line" + d.id)
                    .attr("x", 0) //0 because it keeps it in the center
                    .attr("y", function() {
                        return ++lineNumber * lineHeight + "em";
                    })
                    .text(word);
            }
        }

        var midLineIndex = Math.floor(lineNumber / 4);
        var tspans = document.getElementsByClassName("line" + d.id);
        var i = 0;
        while (tspans[i] !== undefined) {
            tspans[i].setAttribute("y", (i - midLineIndex) * lineHeight + "em");
            i++;
        }
    });
}

})();

function closeLightbox(id, mediaType) {
    	
    // Pause the H5P video before closing it. This will also trigger saving of the settings
    // TODO: Do this for HTML5 video as well
    var h5pObj = document.getElementById('h5p').contentWindow.H5P;
    if (h5pObj !== undefined && mediaType == "video") {
		var h5pVideo = h5pObj.instances[0].video;
		h5pVideo.pause();
    }
    
    updateMediaIcon(id, mediaType, 'play');

    $('#spotlight-overlay').remove();
    $('#spotlight-content').css('opacity', 0);

    // wait for css animation before removing it
    setTimeout(function () {
        $('#spotlight-content').remove();
    }, 1000);

    recordAnalyticsEvent('user', 'close', 'lightbox', id);
}

// Updates the icon for the given media button
function updateMediaIcon(id, mediaType, action) {

    var buttonElementId = "#mediaButtonIcon" + id;
    var classStr = getMediaIconClass(mediaType, action);

    $(buttonElementId).removeAttr('style');
    $(buttonElementId).attr('class', classStr);
}

function getMediaIconClass(mediaType, action) {

    var classStrStart = 'fas fa-';
    var classStrEnd = '-circle';
    var classStr = '';

    switch (mediaType) {

        case "video":
            if (action == 'pause')
                classStr = classStrStart + 'pause' + classStrEnd;
            else if (action == 'loading')
                classStr = 'mediaButtonLoading';
            else
                classStr = classStrStart + 'play' + classStrEnd;
            break;
            
        default:
            classStr = classStrStart + 'exclamation' + classStrEnd;
            break;
    }

    return classStr;
}

var analyticsAJAXUrl = '',  // Analytics (set to empty string to disable analytics)
    analyticsAJAXAction = 'tapestry_tool_log_event';// Analytics

function recordAnalyticsEvent(actor, action, object, objectID, details){

    if (!analyticsAJAXUrl.length || !analyticsAJAXAction.length)
        return false;

    // TODO: Also need to save the tapestry slug or ID in the events

    var userUUID = Cookies.get("user-uuid");
    if (userUUID === undefined) {
        userUUID = createUUID();
        Cookies.set("user-uuid", userUUID);
    }

    if (details === undefined) {
        details = {};
    }

    details['user-ip'] = $('#user-ip').text();

    var data = {
        'action': analyticsAJAXAction,
        'actor': actor,
        'action2': action,
        'object': object,
        'user_guid': userUUID,
        'object_id': objectID,
        'details': JSON.stringify(details)
    };

    // Send the event to an AJAX URL to be saved
    jQuery.post(analyticsAJAXUrl, data, function(response) {
        // Event posted
    });
}

function createUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Capture click events anywhere inside or outside tapestry
$(document).ready(function(){
    document.body.addEventListener('click', function(event) {
        var x = event.clientX + $(window).scrollLeft();
        var y = event.clientY + $(window).scrollTop();
        recordAnalyticsEvent('user', 'click', 'screen', null, {'x': x, 'y': y});
    }, true);
    
    document.getElementById('tapestry').addEventListener('click', function(event) {
        var x = event.clientX + $(window).scrollLeft();
        var y = event.clientY + $(window).scrollTop();
        recordAnalyticsEvent('user', 'click', 'tapestry', null, {'x': x, 'y': y});
    }, true); 
});