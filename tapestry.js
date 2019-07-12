(function(){

/****************************************************
 * CONSTANTS AND GLOBAL VARIABLES
 ****************************************************/

var // declared constants
    TAPESTRY_CONTAINER_ID = "tapestry",
    PROGRESS_THICKNESS = 13,  
    LINK_THICKNESS = 6,
    NORMAL_RADIUS = 93,  
    ROOT_RADIUS_DIFF = 46, 
    GRANDCHILD_RADIUS_DIFF = -66, 
    TRANSITION_DURATION = 800,
    NODE_TEXT_RATIO = 5/6,
    COLOR_STROKE = "#072d42",
    COLOR_GRANDCHILD = "#CCC",
    COLOR_LINK = "#999",
    COLOR_SECONDARY_LINK = "transparent",
    CSS_OPTIONAL_LINK = "stroke-dasharray: 30, 15;",
    TIME_BETWEEN_SAVE_PROGRESS = 5, // Means the number of seconds between each save progress call
    NODE_UNLOCK_TIMEFRAME = 2; // Time in seconds. User should be within 2 seconds of appearsAt time for unlocked nodes
    TAPESTRY_PROGRESS_URL = apiUrl + "/users/progress",
    TAPESTRY_H5P_SETTINGS_URL = apiUrl + "/users/h5psettings",
    ADD_NODE_MODAL_URL = addNodeModalUrl;

var // declared variables
    dataset, root, svg, links, nodes,               // Basics
    originalDataset,                                // For saving the value of the original dataset pre-changes
    path, pieGenerator, arcGenerator,               // Donut
    simulation,                                     // Force
    nodeCoordinates = [],                           // For saving the coordinates of the Tapestry pre transition to play mode
    adjustedRadiusRatio = 1,                        // Radius adjusted for view mode
    tapestrySlug, 
    saveProgress = true, progressLastSaved = new Date(), // Saving Progress
    nodeImageHeight = 280,                          // originally 420
    nodeImageWidth = 520,                           // originally 780
    rootNodeImageHeightDiff = 46,                   // originally 70
    h5pVideoSettings = {},
    tapestryDepth = 2;                              // Default depth of Tapestry

// FLAGS
var inViewMode = false;                             // Flag for when we're in view mode

var // calculated
    MAX_RADIUS = NORMAL_RADIUS + ROOT_RADIUS_DIFF + 30,     // 30 is to count for the icon
    innerRadius = NORMAL_RADIUS * adjustedRadiusRatio - ((PROGRESS_THICKNESS * adjustedRadiusRatio) / 2),
    outerRadius = NORMAL_RADIUS * adjustedRadiusRatio + ((PROGRESS_THICKNESS * adjustedRadiusRatio) / 2);

/****************************************************
 * INITIALIZATION
 ****************************************************/

/* Import data from json file, then start D3 */
jQuery.ajaxSetup({
    beforeSend: function (xhr) {
        if (wpApiSettings && wpApiSettings.nonce) {
            xhr.setRequestHeader( 'X-WP-Nonce', wpApiSettings.nonce );
        }
    }
});

jQuery.get(apiUrl + "/tapestries/" + tapestryWpPostId, function(result){
    dataset = result;
    createRootNodeButton(dataset);
    if (dataset && dataset.nodes && dataset.nodes.length > 0) {
        dataset.nodes[0].typeData.unlocked = true;
    }
    originalDataset = result;
    saveCoordinates();

    //---------------------------------------------------
    // 1. GET PROGRESS FROM COOKIE (IF ENABLED)
    //---------------------------------------------------

    tapestrySlug = dataset.settings.tapestrySlug;
    
    if (saveProgress) {
        // If user is logged in, get progress from database database
        if (tapestryWpUserId) {

            jQuery.get(TAPESTRY_PROGRESS_URL, { "post_id": tapestryWpPostId }, function(result) {
                if (result && !isEmptyObject(result)) {
                    setDatasetProgress(JSON.parse(result));
                    updateViewedProgress(); // update viewed progress because async fetch of dataset
                }
            }).fail(function(e) {
                console.error("Error with retrieving node progress");
                console.error(e);
            });

            jQuery.get(TAPESTRY_H5P_SETTINGS_URL, { "post_id": tapestryWpPostId }, function(result) {
                if (result && !isEmptyObject(result)) {
                    h5pVideoSettings = JSON.parse(result);
                }
            }).fail(function(e) {
                console.error("Error with retrieving h5p video settings");
                console.error(e);
            });

        } else { 
            // Update dataset with data from cookie (if any)
            var cookieProgress = Cookies.get("progress-data-"+tapestrySlug);

            if (cookieProgress) {
                cookieProgress = JSON.parse( cookieProgress );
                setDatasetProgress(cookieProgress);	
            }

            // Update H5P Video Settings from cookie (if any)
            var cookieH5PVideoSettings = Cookies.get("h5p-video-settings");
            if (cookieH5PVideoSettings) {
                cookieH5PVideoSettings = JSON.parse( cookieH5PVideoSettings );
                h5pVideoSettings = cookieH5PVideoSettings;
            }
        }
    }

    //---------------------------------------------------
    // 2. SIZE AND SCALE THE TAPESTRY AND SVG TO FIT WELL
    //---------------------------------------------------

    // establish initial positioning before the startforce()
    // this so 'getNodeDimensions' is operational at this stage
    for (var index in dataset.nodes) {
        if (dataset.nodes[index].x == null) {
            dataset.nodes[index].x = getBrowserWidth()*0.9;
        }
        if (dataset.nodes[index].y == null) {
            dataset.nodes[index].y = getBrowserHeight()*0.9;
        }
    }

    // do it now
    updateTapestrySize();
    // Also do it whenever window is resized
    $(window).resize(function(){
        updateTapestrySize();
    });
        
    //---------------------------------------------------
    // 3. SET NODES/LINKS AND CREATE THE SVG OBJECTS
    //---------------------------------------------------

    root = dataset.rootId;

    setNodeTypes(root);
    setLinkTypes(root);
    setUnlocked();

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
    filterNodes();
    buildNodeContents();

    //---------------------------------------------------
    // 4. UPDATE SVG DIMENSIONS AND START THE GRAPH
    //---------------------------------------------------

    // Remove fx & fy remnant upon refresh
    d3.selectAll('g.node').each(function(d){
        delete d.fx;
        delete d.fy;
    });

    startForce();
    
    // Ensure tapestry size fits well into the browser and start force
    updateSvgDimensions(TAPESTRY_CONTAINER_ID);

    recordAnalyticsEvent('app', 'load', 'tapestry', tapestrySlug);
}).fail(function(e) {
    console.error("Error with loading tapestries");
    console.error(e);
});

/****************************************************
 * ADD TAPESTRY CONTROLS
 ****************************************************/

//--------------------------------------------------
// Create wrapper div for tapestry controls
//--------------------------------------------------

var tapestryControlsDiv = document.createElement("div");
tapestryControlsDiv.id = "tapestry-controls-wrapper";
document.getElementById(TAPESTRY_CONTAINER_ID).appendChild(tapestryControlsDiv);

//--------------------------------------------------
// Add in Depth Slider
//--------------------------------------------------

// Create wrapper div 
var depthSliderWrapper = document.createElement("div");
depthSliderWrapper.id = "tapestry-depth-slider-wrapper";
depthSliderWrapper.style.display = "none";

// Create label element
var tapestryDepthSliderLabel = document.createElement("label");
tapestryDepthSliderLabel.innerHTML = "Depth: ";
depthSliderWrapper.appendChild(tapestryDepthSliderLabel);

// Create input element
var tapestryDepthSlider = document.createElement("input");
setAttributes(tapestryDepthSlider ,{
    type:"range",
    min:"1",
    max:"3",
    value:"2",
    id:"tapestry-depth-slider"
});
depthSliderWrapper.appendChild(tapestryDepthSlider);

// Hide depth slider if depth is less than 3 
function hideShowDepthSlider() {
    depthSliderWrapper.style.display = (findMaxDepth(root) >= 3) ? "block" : "none";
}
hideShowDepthSlider(); // run it now (we will also run it later when tapestry is modified)

// Every time the slider's value is changed, do the following
tapestryDepthSlider.onchange = function() {
    tapestryDepth = this.value;

    setNodeTypes(root);
    setLinkTypes(root);
    filterLinks();
    filterNodes();

    rebuildNodeContents();
};

tapestryControlsDiv.appendChild(depthSliderWrapper);

//--------------------------------------------------
// Checkbox to view locked nodes (logged in users only)
//--------------------------------------------------

// Create wrapper div
var viewLockedCheckboxWrapper = document.createElement("div");
viewLockedCheckboxWrapper.id = "tapestry-view-locked-checkbox-wrapper";

// Create input element
var viewLockedCheckbox = document.createElement("input");
setAttributes(viewLockedCheckbox,{
    type:"checkbox",
    value:"1",
    id: "tapestry-view-locked-checkbox"
});
viewLockedCheckbox.onchange = function() {
    filterNodes();
    filterLinks();
    rebuildNodeContents();
};

// Create label element
var viewLockedLabel = document.createElement("label");
viewLockedLabel.innerHTML = " View locked nodes";
setAttributes(viewLockedLabel,{
    forHtml:"tapestry-view-locked-checkbox"
});

viewLockedCheckboxWrapper.appendChild(viewLockedCheckbox);
viewLockedCheckboxWrapper.appendChild(viewLockedLabel);

if (tapestryWpUserId) {
    // Append the new element in its wrapper to the tapestry container
    tapestryControlsDiv.appendChild(viewLockedCheckboxWrapper);
}

/****************************************************
 * ADD EDITOR ELEMENTS
 ****************************************************/

//--------------------------------------------------
// Insert the "Add Root Node" button if no nodes
//--------------------------------------------------
function createRootNodeButton(dataset) {

    if (!dataset || dataset.nodes.length == 0) {
        var rootNodeDiv = document.createElement("div");
        rootNodeDiv.id = "root-node-container";
        rootNodeDiv.innerHTML = '<div id="root-node-btn"><i class="fas fa-plus-circle fa-5x"></i><div id="root-node-label">Add Root Node</div></div>';

        if (tapestryWpUserId) {
            document.getElementById(TAPESTRY_CONTAINER_ID).append(rootNodeDiv);
        }

        $("#root-node-btn").on("click", function(e) {
            $('#createNewNodeModalLabel').text("Add root node");
            $("#submit-add-new-node").hide();
            $("#submit-add-root-node").show();
            $("#appearsat-section").hide();
            // Show the modal
            $("#createNewNodeModal").modal();
        });
    }
}

//--------------------------------------------------
// Insert the modal template
//--------------------------------------------------

var modalDiv = document.createElement("div");
modalDiv.id = "tapeestry-modal-div";
document.getElementById(TAPESTRY_CONTAINER_ID).append(modalDiv);
$("#tapeestry-modal-div").load(ADD_NODE_MODAL_URL, function(responseTxt, statusTxt, xhr){
    if (statusTxt == "success") {

        // Adding Root Node
        $("#submit-add-root-node").on("click", function(e) {
            e.preventDefault(); // cancel the actual submit
            var formData = $("form").serializeArray();
            tapestryAddNewNode(formData, true);
        });

        // Adding New Nodes
        $("#submit-add-new-node").on("click", function(e) {
            e.preventDefault(); // cancel the actual submit
            var formData = $("form").serializeArray();
            tapestryAddNewNode(formData);
        });

        $("#mediaFormat").on("change", function(){
            var selectedType = $(this).val();
            switch(selectedType)
            {
                case "mp4":
                    $("#contents-details").show();
                    $("#mp4-content").show();
                    $("#h5p-content").hide();
                    break;
                case "h5p":
                    $("#contents-details").show();
                    $("#mp4-content").hide();
                    $("#h5p-content").show();
                    break;
                default:
                    $("#contents-details").hide();
                    $("#mp4-content").hide();
                    $("#h5p-content").hide();
                    break;
            }
        });

        $("#cancel-add-new-node").on("click", function() {
            tapestryHideAddNodeModal();
        });
        hideShowDepthSlider();
    }
});

// Function for adding a new node
function tapestryAddNewNode(formData, isRoot) {

    if (typeof isRoot == 'undefined') {
        isRoot = false;
    }

    var errorMsg = tapestryValidateNewNode(formData, isRoot);
    if (errorMsg) {
        alert(errorMsg);
        return;
    }

    // Add the node data first
    var newNodeEntry = {
        "type": "tapestry_node",
        "status": "publish",
        "nodeType": "",
        "title": "",
        "imageURL": "",
        "mediaType": "video",
        "mediaFormat": "",
        "mediaDuration": 0,
        "typeId": 1,
        "group": 1,
        "typeData": {
            "progress": [
                {"group": "viewed", "value": 0},
                {"group": "unviewed", "value": 1}
            ],
            "mediaURL": "",
            "mediaWidth": 960,      //TODO: This needs to be flexible with H5P
            "mediaHeight": 600,
            "unlocked": true
        },
        "x": getBrowserWidth(),
        "y": getBrowserHeight()
    };

    if (!isRoot) {
        // Just put the node right under the current node
        newNodeEntry.x = dataset.nodes[findNodeIndex(root)].x;
        newNodeEntry.y = dataset.nodes[findNodeIndex(root)].y + (NORMAL_RADIUS + ROOT_RADIUS_DIFF) * 2 + 50;
    }

    var appearsAt = 0;
    for (var i = 0; i < formData.length; i++) {
        var fieldName = formData[i].name;
        var fieldValue = formData[i].value;

        switch (fieldName) {
            case "title":
                newNodeEntry[fieldName] = fieldValue;
                break;
            case "imageURL":
                newNodeEntry[fieldName] = fieldValue;
                break;
            case "mediaType":
                newNodeEntry[fieldName] = fieldValue;
                break;
            case "mediaFormat":
                newNodeEntry[fieldName] = fieldValue;
                break;
            case "mp4-mediaURL":
                if (fieldValue !== "") {
                    newNodeEntry.typeData.mediaURL = fieldValue;
                }
                break;
            case "h5p-mediaURL":
                if (fieldValue !== "") {
                    newNodeEntry.typeData.mediaURL = fieldValue;
                }
                break;
            case "mp4-mediaDuration":
                    if (fieldValue !== "") {
                        newNodeEntry.mediaDuration = parseInt(fieldValue);
                    }
                break;
            case "h5p-mediaDuration":
                if (fieldValue !== "") {
                    newNodeEntry.typeData.mediaDuration = parseInt(fieldValue);
                }
                break;
            case "appearsAt":
                appearsAt = parseInt(fieldValue);
                newNodeEntry.typeData.unlocked = !appearsAt || isRoot;
                break;
            default:
                break;
        }
    }

    // Save to database, first save node then the link
    jQuery.post(apiUrl + "/tapestries/" + tapestryWpPostId + "/nodes", JSON.stringify(newNodeEntry), function(result){
        // only add link if it's for adding new node and not root node
        // Add new node to dataset after getting the id
        newNodeEntry.id = result.id;
        dataset.nodes.push(newNodeEntry);

        if (!isRoot) {
            // Get ID from callback and set it as target's id
            var newLink = {"source": root, "target": result.id, "value": 1, "type": "", "appearsAt": appearsAt };

            jQuery.post(apiUrl + "/tapestries/" + tapestryWpPostId + "/links", JSON.stringify(newLink), function(result) {

                // Add the new link to the dataset
                dataset.links.push(newLink);

                tapestryHideAddNodeModal();
                redrawTapestryWithNewNode();
            }).fail(function(e) {
                console.error("Error with adding new link", e);
            });
        } else {
            // Redraw root node
            dataset.rootId = result.id;
            tapestryHideAddNodeModal();
            root = dataset.rootId; // need to set root to newly created node

            redrawTapestryWithNewNode(true);
            $("#root-node-container").hide(); // hide the root node button after creating it.
        }
    }).fail(function(e) {
        console.error("Error with adding new node");
        console.error(e);
    });
}

function tapestryHideAddNodeModal() {
    $("#createNewNodeModalBody input[type='text']").val("");
    $("#createNewNodeModalBody input[type='url']").val("");
    $("#createNewNodeModal").modal("hide");
    $("#appearsat-section").show();
}

function redrawTapestryWithNewNode(isRoot) {

    if (typeof isRoot == 'undefined') {
        isRoot = false;
    }

    saveCoordinates();
    updateTapestrySize();

    setNodeTypes(root);
    setLinkTypes(root);
    setUnlocked();

    // Rebuild the nodes and links
    links = createLinks();
    nodes = createNodes();

    filterLinks();
    if (!isRoot) {
        filterNodes();
    }
    // Rebuild everything to include the new node
    buildNodeContents();
    if (!isRoot) {
        rebuildNodeContents();
    }
    updateSvgDimensions(TAPESTRY_CONTAINER_ID);
}

function tapestryValidateNewNode(formData, isRoot) {

    if (typeof isRoot == 'undefined') {
        isRoot = false;
    }
    
    var errMsg = "";

    for (var i = 0; i < formData.length; i++) {
        var fieldName = formData[i].name;
        var fieldValue = formData[i].value;

        switch (fieldName) {
            case "title":
                if (fieldValue === "") {
                    errMsg += "Please enter a title \n";
                }
                break;
            case "imageURL":
                if (fieldValue === "") {
                    errMsg += "Please enter a thumbnail URL \n";
                }
                break;
            case "appearsAt":
                if (fieldValue.length > 0 && !onlyContainsDigits(fieldValue) && !isRoot) {
                    errMsg += "Please enter numeric value for Appears At (or leave empty to not lock) \n";
                }
                break;
            default:
                break;
        }
        if ($("#mediaFormat").val() === "mp4") {
            switch (fieldName) {
                case "mp4-mediaURL":
                    if (fieldValue === "") {
                        errMsg += "Please enter a MP4 video URL \n";
                    }
                    break;
                case "mp4-mediaDuration":
                    if (!onlyContainsDigits(fieldValue)) {
                        errMsg += "Please enter numeric value for media duration \n";
                    }
                    break;
                default:
                    break;
            }
        } else if ($("#mediaFormat").val() === "h5p") {
            switch (fieldName) {
                case "h5p-mediaURL":
                    if (fieldValue === "") {
                        errMsg += "Please enter a H5P URL \n";
                    }
                    break;
                case "h5p-mediaDuration":
                    if (!onlyContainsDigits(fieldValue)) {
                        errMsg += "Please enter numeric value for media duration \n";
                    }
                    break;
                default:
                    break;
            }
        } else {
            errMsg += "Please enter correct media format \n";
        }
    }
    return errMsg;
}

/****************************************************
 * D3 RELATED FUNCTIONS
 ****************************************************/

/* Define forces that will determine the layout of the graph */
function startForce() {

    var nodes = dataset.nodes;
    var tapestryDimensions = getTapestryDimensions();

    simulation = d3.forceSimulation(nodes)

        // "charge" and forceManyBody determine the the repulsion/attraction strength
        .force("charge", d3.forceManyBody().strength(-4000))

        // establish links, the function sets IDs as endpoints, rather than indexes
        .force("link", d3.forceLink(dataset.links).id(function(d) {
            return d.id;
        }))

        // slow down the nodes from spinning
        .velocityDecay(0.99)

        // "center" determines where the center of gravity is
        .force("center", d3.forceCenter()
            .x(tapestryDimensions.width / 2)
            .y(tapestryDimensions.height / 2))

        // determines the minimum distance that nodes are allowed to be positioned at
        .force("collision", d3.forceCollide().radius(function (d) {
            if (root === d.id) {
                return MAX_RADIUS;
            }
            else {
                return (MAX_RADIUS - 25);
            }
        }));

    simulation
        .nodes(dataset.nodes)
        .on("tick", ticked);
    
}

//Resize all nodes, where id is now the root
function resizeNodes(id) {
    getChildren(id);
    setNodeTypes(id);
    setLinkTypes(id);
    filterLinks();
    filterNodes();

    rebuildNodeContents();
}

function ticked() {
    var tapestryDimensions = getTapestryDimensions();
    links
        .attr("x1", function (d) {
            return getBoundedCoord(d.source.x, tapestryDimensions.width);
        })
        .attr("y1", function (d) {
            return getBoundedCoord(d.source.y, tapestryDimensions.height);
        })
        .attr("x2", function (d) {
            return getBoundedCoord(d.target.x, tapestryDimensions.width);
        })
        .attr("y2", function (d) {
            return getBoundedCoord(d.target.y, tapestryDimensions.height);
        });
    nodes
        .attr("cx", function (d) {
            return getBoundedCoord(d.x, tapestryDimensions.width);
        })
        .attr("cy", function (d) {
            return getBoundedCoord(d.y, tapestryDimensions.height);
        })
        .attr("transform", function (d) {
            return "translate(" + getBoundedCoord(d.x, tapestryDimensions.width) + "," + getBoundedCoord(d.y, tapestryDimensions.height) + ")";
        });
}



// D3 DRAGGING FUNCTIONS
function dragstarted(d) {
    var tapestryDimensions = getTapestryDimensions();
    if (!d3.event.active) simulation.alphaTarget(0.2).restart();
    
    d.x = getBoundedCoord(d.x, tapestryDimensions.width);
    d.y = getBoundedCoord(d.y, tapestryDimensions.height);

    recordAnalyticsEvent('user', 'drag-start', 'node', d.id, {'x': d.x, 'y': d.y});
}

function dragged(d) {
    d.x = d3.event.x;
    d.y = d3.event.y;
}

function dragended(d) {
    if (!d3.event.active) simulation.alphaTarget(0);

    if (tapestryWpUserId) {
        $.ajax({
            url: apiUrl + "/tapestries/" + tapestryWpPostId + "/nodes/" + d.id + "/coordinates",
            method: 'PUT',
            data: JSON.stringify({x: d.x, y: d.y}),
            success: function(result) {
                d.x = d.x;
                d.y = d.y;
            },
            error: function(e) {
                console.error("Error saving coordinates of nodes");
                console.error(e);
            }
        });
    }

    recordAnalyticsEvent('user', 'drag-end', 'node', d.id, {'x': d.x, 'y': d.y});
}

// creates SVG that tapestry is displayed on 
function createSvgContainer(containerId) {
    var tapestryDimensions = getTapestryDimensions();
    return d3.select("#"+containerId)
                .append("svg:svg")
                .attr("id", containerId+"-svg")
                .attr("viewBox", "0 0 " + tapestryDimensions.width + " " + tapestryDimensions.height)
                .attr("preserveAspectRatio", "xMidYMid meet")
                .append("svg:g");
}

function updateSvgDimensions(containerId) {
    var tapestryDimensions = getTapestryDimensions();
    d3.select("#"+containerId+"-svg")
        .attr("viewBox", "0 0 " + tapestryDimensions.width + " " + tapestryDimensions.height);
    startForce();
}

function createLinks() {
    /* Need to remove old links when redrawing graph */
    if (links !== undefined) {
        svg.selectAll('line')
            .data(dataset.links)
            .remove();
    }

    /* Now, can draw the links */
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
    if (nodes !== undefined) {
        svg.selectAll("g.node")
            .data(dataset.nodes)
            .remove();
    }

    /* Now, can draw the nodes */
    return svg.selectAll("g.node")
                .data(dataset.nodes)
                .enter()
                .append("svg:g")
                    .attr("class", "node")
                    .attr("id", function (d) {
                        return "node-" + d.id;
                    });
}

// selects which links to show
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
        var targetIndex = findNodeIndex(targetId);
        if ((sourceId === root || targetId === root) && getViewable(dataset.nodes[targetIndex])) {
            shouldRender = true;
        } else if ((getChildren(root, tapestryDepth - 1).indexOf(sourceId) > -1 || getChildren(root, tapestryDepth - 1).indexOf(targetId) > -1) && !inViewMode && getViewable(dataset.nodes[targetIndex])) {
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
        var targetIndex = findNodeIndex(targetId);
        if ((sourceId === root || targetId === root) && getViewable(dataset.nodes[targetIndex])) {
            shouldRender = true;
        } else if ((getChildren(root, tapestryDepth - 1).indexOf(sourceId) > -1 || getChildren(root, tapestryDepth - 1).indexOf(targetId) > -1) && !inViewMode && getViewable(dataset.nodes[targetIndex])) {
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
    tapestryDepthSlider.max = findMaxDepth(root);
    hideShowDepthSlider();
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
            return PROGRESS_THICKNESS * adjustedRadiusRatio;
        })
        .attr("stroke", function (d) {
            if (!getViewable(d))
                return "transparent";
            else if (d.nodeType === "grandchild")
                return COLOR_GRANDCHILD;
            else return COLOR_STROKE;
        })
        .attr("width", function (d) {
            if (!getViewable(d)) return 0;
            return getRadius(d) * 2;
        })
        .attr("height", function (d) {
            if (!getViewable(d)) return 0;
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
            if (!getViewable(d))
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
                // slider's maximum depth is set to the longest path from the new root
                tapestryDepthSlider.max = findMaxDepth(root);
            }
            recordAnalyticsEvent('user', 'click', 'node', d.id);
        });
}

function rebuildNodeContents() {
    /* Remove text before transition animation */
    $(".title").remove();

    /* Commence transition animation */
    nodes.selectAll(".imageOverlay")
            .transition()
            .duration(TRANSITION_DURATION/2)
            .attr("r", function (d) {
                var rad = getRadius(d);
                if (rad > (PROGRESS_THICKNESS * adjustedRadiusRatio)/2)
                    return rad - (PROGRESS_THICKNESS * adjustedRadiusRatio)/2;
                else
                    return 0;
            })
            .attr("fill", function (d) {
                if (!getViewable(d)) {
                    return "transparent";
                } else if (d.nodeType === "grandchild")
                    return COLOR_GRANDCHILD;
                else return COLOR_STROKE;
            });
            
    nodes.selectAll(".imageContainer")
            .attr("class", function (d) {
                if (!getViewable(d))
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
                if (!getViewable(d))
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
            })
            .attr("stroke-width", function (d) {
                return PROGRESS_THICKNESS * adjustedRadiusRatio;
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
    nodes.selectAll(".addNodeButton").remove();
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
            return getViewable(d);
        })
        .append("text")
        .attr("data-id", function (d) {
            return d.id;
        })
        .attr("style", function (d) {
            return d.nodeType === "grandchild" ? "visibility: hidden" : "visibility: visible";
        });

    /* Create the node titles */
    nodes
        .filter(function (d){
            return d.depth < tapestryDepth;
        })
        .append('foreignObject')
        .attr("width", NORMAL_RADIUS * 2 * NODE_TEXT_RATIO)
        .attr("height", NORMAL_RADIUS * 2 * NODE_TEXT_RATIO)
        .attr("x", -NORMAL_RADIUS * NODE_TEXT_RATIO)
        .attr("y", -NORMAL_RADIUS * NODE_TEXT_RATIO)
        .append("xhtml:div")
            .attr("class","title")
            .html(function(d){
                return "<p>" + d.title + "</p>";
            });

    // Append mediaButton
    nodes
        .filter(function (d) {
            return getViewable(d);
        })
        .append("svg:foreignObject")
        .html(function (d) {
            return '<i id="mediaButtonIcon' + d.id + '"' + 
                ' class="' + getIconClass(d.mediaType, 'play') + ' mediaButtonIcon"' +
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
        .attr("width", "60px")
        .attr("height", "62px") 
        .attr("x", -27)
        .attr("y", function (d) {
            return -NORMAL_RADIUS * adjustedRadiusRatio - 30 - (d.nodeType === "root" ? ROOT_RADIUS_DIFF : 0);
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

    // Append addNodeButton
    nodes
        .filter(function (d) {
            return d.nodeType === "root" && tapestryWpUserId;
        })
        .append("svg:foreignObject")
        .html(function (d) {
            return '<i id="addNodeIcon' + d.id + '"' +
                ' class="' + getIconClass("add") + ' addNodeIcon"' +
                ' data-id="' + d.id + '"><\/i>';
        })
        .attr("id", function (d) {
            return "addNodeIcon" + d.id;
        })
        .attr("data-id", function (d) {
            return d.id;
        })
        .attr("width", "60px")
        .attr("height", "62px")
        .attr("x", -27)
        .attr("y", function (d) {
            return NORMAL_RADIUS + ROOT_RADIUS_DIFF - 30;
        })
        .attr("style", function (d) {
            return d.nodeType === "grandchild" || d.nodeType === "child" ? "visibility: hidden" : "visibility: visible";
        })
        .attr("class", "addNodeButton");

    $('.addNodeButton > i').click(function(){
        // Set up the title of the form
        $('#createNewNodeModalLabel').text("Add new sub-topic to " + dataset.nodes[findNodeIndex(root)].title);
        $("#submit-add-root-node").hide();	
        $("#submit-add-new-node").show();
        // Show the modal
        $("#createNewNodeModal").modal();
    });
}

function updateViewedProgress() {
    path = nodes
        .filter(function (d) {
            return d.nodeType !== "" && d.typeData.unlocked;
        })
        .selectAll("path")
        .data(function (d, i) {
            var data = d.typeData.progress;
            data.forEach(function (e) {
                e.extra = {'nodeType': d.nodeType, 'unlocked': d.typeData.unlocked };
            })
            return pieGenerator(data, i);
        });

    path.transition().duration(750).attrTween("d", arcTween);

    path.enter()
        .append("path")
        .attr("fill", function (d, i) {
            if (d.data.group !== "viewed") return "transparent";

            var viewableByUser = true;
            if (d.data.extra.nodeType === "grandchild" || d.data.extra.nodeType === "" || !d.data.extra.unlocked || !viewableByUser)
                return "#cad7dc";
            else return "#11a6d8";
        })
        .attr("class", function (d) {
            var viewableByUser = true;
            if (d.data.extra.nodeType === "grandchild" || d.data.extra.nodeType === "" || !d.data.extra.unlocked || !viewableByUser)
                return "expandGrandchildren";
        })
        .attr("d", function (d) {
            return arcGenerator(adjustProgressBarRadii(d));
        });
}

function arcTween(a) {
    var i = d3.interpolate(this._current, a);
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
        addedRadiusInner = -1 * (innerRadius + addedRadius); // set inner radius to 0
    }
    arcGenerator.innerRadius(innerRadius * adjustedRadiusRatio + addedRadius + addedRadiusInner)(d);
    arcGenerator.outerRadius(outerRadius * adjustedRadiusRatio + addedRadius)(d);
    return d;
}

/****************************************************
 * MEDIA RELATED FUNCTIONS
 ****************************************************/

function setupLightbox(id, mediaFormat, mediaType, mediaUrl, width, height) {
    // Adjust the width and height here before passing it into setup media
    var lightboxDimensions = getLightboxDimensions(height, width);

    width = lightboxDimensions.width;
    height = lightboxDimensions.height;
    var media = setupMedia(id, mediaFormat, mediaType, mediaUrl, width, height);

    $('<div id="spotlight-overlay"><\/div>').on("click", function(){
        closeLightbox(id, mediaType);
        exitViewMode();
    }).appendTo('body');

    var top = lightboxDimensions.adjustedOn === "width" ? ((getBrowserHeight() - height) / 2) + $(this).scrollTop() : (NORMAL_RADIUS * 1.5) + (NORMAL_RADIUS * 0.1);
    $('<div id="spotlight-content" data-media-format="' + mediaFormat + '"><\/div>').css({
        top: top,
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

    $('<a class="lightbox-close">X</a>')
        .css({
            background: "none",
            "box-shadow": "none",
            cursor: "pointer"
        })
        .on("click", function() {
            closeLightbox(id, mediaType);
            exitViewMode();
        })
        .appendTo('#spotlight-content');

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
        changeToViewMode(lightboxDimensions);
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

function getLightboxDimensions(videoHeight, videoWidth) {
    var resizeRatio = 1;
    if (videoWidth > getBrowserWidth()) {
        resizeRatio = getBrowserWidth() / videoWidth;
        videoWidth *= resizeRatio;
        videoHeight *= resizeRatio;
    }

    // Possibly interfering with the resizer
    if (videoHeight > getBrowserHeight() * resizeRatio) {
        resizeRatio *= getBrowserHeight() / videoHeight;
        videoWidth *= resizeRatio;
        videoHeight *= resizeRatio;
    }

    var nodeSpace = (NORMAL_RADIUS * 2) * 1.3;     // Calculate the amount of space we need to reserve for nodes
    var adjustedVideoHeight = getBrowserHeight() - nodeSpace;               // Max height for the video
    var adjustedVideoWidth = getBrowserWidth() - nodeSpace;                 // Max width for the video

    if (adjustedVideoHeight > videoHeight) {
        adjustedVideoHeight = videoHeight;
    }
    if (adjustedVideoWidth > videoWidth) {
        adjustedVideoWidth = videoWidth;
    }

    var heightAdjustmentRatio = adjustedVideoHeight / videoHeight;
    var widthAdjustmentRatio = adjustedVideoWidth / videoWidth;

    var adjustmentRatio = widthAdjustmentRatio;                       // Object indicating everything you need to know to make the adjustment
    var adjustedOn = "width";
    if (getAspectRatio() < 1) {
        adjustedOn = "height";
        adjustmentRatio = heightAdjustmentRatio;
    }

    adjustmentRatio *= 0.95;

    return {
        "adjustedOn": adjustedOn,
        "width": videoWidth * adjustmentRatio,
        "height": videoHeight * adjustmentRatio
    };
}

function setupMedia(id, mediaFormat, mediaType, mediaUrl, width, height) {

    var buttonElementId = "#mediaButtonIcon" + id;

    // Add the loading gif
    $(buttonElementId).addClass('mediaButtonLoading');

    var index = findNodeIndex(id);
    var viewedAmount;
    var mediaEl;

    var childrenData = getChildrenData(id);

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
                    for (var i = 0; i < childrenData.length; i++) {
                        if (Math.abs(childrenData[i].appearsAt - video.currentTime) <= NODE_UNLOCK_TIMEFRAME && video.paused === false && !dataset.nodes[childrenData[i].nodeIndex].typeData.unlocked) {
                            setUnlocked(childrenData[i].nodeIndex);
                            filterLinks();
                            filterNodes();
                            rebuildNodeContents();
                        }
                    }
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

// Builds the view mode, including functionality to
function changeToViewMode(lightboxDimensions) {
    inViewMode = true;
    originalDataset = dataset;
    var children = getChildren(root);
    setAdjustedRadiusRatio(lightboxDimensions.adjustedOn, children.length);
    var coordinates = getViewModeCoordinates(lightboxDimensions, children);

    // Add the coordinates to the nodes
    d3.selectAll('g.node').each(function(d) {
        d.fixed = true;
        if (d.nodeType === "root") {
            d.fx = getTapestryDimensions().width / 2;
            if (lightboxDimensions.adjustedOn === "width") {
                d.fy = getTapestryDimensions().height / 2;
            } else {
                d.fy = screenToSVG(0, $("#header").height() + NORMAL_RADIUS + ($("#spotlight-content").height() / 2)).y;
            }
        } else if (d.nodeType === "child") {
            d.fx = coordinates[d.id].x;
            d.fy = coordinates[d.id].y;
        }
    });

    filterLinks();
    filterNodes();
    if (adjustedRadiusRatio < 1) {
        rebuildNodeContents();
    }
    startForce();
}

function getViewModeCoordinates(lightboxDimensions, children) {
    // For determining how much space the node to be placed
    var nodeRadius = NORMAL_RADIUS * adjustedRadiusRatio * 0.8;
    var nodeSpace = (nodeRadius * 2);

    var coordinates = [];

    for (var i = 0; i < children.length; i++) {
        if (children.length <= 2) {
            if (lightboxDimensions.adjustedOn === "width") {
                if (i % 2 === 0) {
                    coordinates[children[i]] = {
                        "x": 0,
                        "y": getTapestryDimensions().height / 2
                    };
                } else {
                    coordinates[children[i]] = {
                        "x": screenToSVG(getBrowserWidth(), 0).x - nodeSpace,
                        "y": getTapestryDimensions().height / 2
                    };
                }
            } else {
                if (i % 2 === 0) {
                    coordinates[children[i]] = {
                        "x": getTapestryDimensions().width / 2,
                        "y": 0
                    };
                } else {
                    coordinates[children[i]] = {
                        "x": getTapestryDimensions().width / 2,
                        "y": getTapestryDimensions().height - nodeSpace
                    };
                }
            }
        } else {
            if (lightboxDimensions.adjustedOn === "width") {
                if (i % 2 === 0) {
                    coordinates[children[i]] = {
                        "x": 0,
                        "y": Math.min(screenToSVG(0, getBrowserHeight() * (i / (children.length - 1))).y + nodeRadius, getTapestryDimensions().height - nodeSpace)
                    };
                } else {
                    coordinates[children[i]] = {
                        "x": screenToSVG(getBrowserWidth(), 0).x - nodeSpace,
                        "y": Math.min(screenToSVG(0, getBrowserHeight() * ((i-1) / (children.length - 1))).y + nodeRadius, getTapestryDimensions().height - nodeSpace)
                    };
                }
            } else {
                if (i % 2 === 0) {
                    coordinates[children[i]] = {
                        "x": Math.min(getTapestryDimensions().width * (i / (children.length - 1)) + nodeRadius, getTapestryDimensions().width - (nodeSpace * 2)),
                        "y": 0
                    };
                } else {
                    coordinates[children[i]] = {
                        "x": Math.min(getTapestryDimensions().width * ((i - 1) / (children.length - 1)) + nodeRadius, getTapestryDimensions().width - (nodeSpace * 2)),
                        "y": screenToSVG(0, (NORMAL_RADIUS * 1.5) + (NORMAL_RADIUS * 0.1) + $("#spotlight-content").height() + $(".mediaButtonIcon").height()).y
                    };
                }
            }
        }
    }

    return coordinates;
}

// For calculating adjustment ratio for adjusting the size of NORMAL_RADIUS for the child nodes while in view mode
// Returns 1 if not in view mode
function setAdjustedRadiusRatio(adjustedOn, numChildren) {
    if (inViewMode) {
        if (adjustedOn === "width") {
            adjustedRadiusRatio = (getBrowserHeight() / (Math.ceil(numChildren / 2) * NORMAL_RADIUS * 2 * 1.2)).toPrecision(4);
        } else {
            adjustedRadiusRatio = (getBrowserWidth() / (Math.ceil(numChildren / 2) * NORMAL_RADIUS)).toPrecision(4);
        }

        if (adjustedRadiusRatio > 1) adjustedRadiusRatio = 1;
    } else {
        adjustedRadiusRatio = 1;
    }
}

function exitViewMode() {
    // For reapplying the coordinates of all the nodes prior to transitioning to play-mode
    for (var i in dataset.nodes) {
        var id = dataset.nodes[i].id;
        dataset.nodes[i].x = nodeCoordinates[id].x;
        dataset.nodes[i].y = nodeCoordinates[id].y;
    }

    d3.selectAll('g.node')
        .each(function(d) {
            d.fixed = false;
            delete d.fx;
            delete d.fy;
        });

    d3.selectAll('g.node')
        .transition()
        .duration(TRANSITION_DURATION);
        
    inViewMode = false;
    filterLinks();
    filterNodes();
    updateTapestrySize();
    if (adjustedRadiusRatio < 1) {
        setAdjustedRadiusRatio(null, null);  //Values set to null because we don't really care; Function should just return 1
        rebuildNodeContents();
    }
}

// Helper function for hiding/showing grandchild nodes when entering/exiting view mode
function filterNodes() {
    var nodesToHide = nodes.filter(function (d) {
        var shouldRender = false;
        if (!getViewable(d)) {
            shouldRender = false;
        } else {
            shouldRender = true;
        }
        return !shouldRender;
    });

    var nodesToShow = nodes.filter(function (d) {
        var shouldRender = false;
        if (!getViewable(d)) {
            shouldRender = false;
        } else {
            shouldRender = true;
        }
        return shouldRender;
    });

    nodesToShow
        .style("display", "block");

    nodesToHide
        .transition()
        .duration(TRANSITION_DURATION)
        .style("opacity", "0");

    nodesToShow
        .transition()
        .duration(TRANSITION_DURATION)
        .style("opacity", "1");

    setTimeout(function(){
        nodesToHide.style("display", "block");
    }, TRANSITION_DURATION);
}

/****************************************************
 * HELPER FUNCTIONS
 ****************************************************/

// Set multiple attributes for an HTML element at once
function setAttributes(elem, obj) {
    for (var prop in obj) {
        if (obj.hasOwnProperty(prop)) {
            elem[prop] = obj[prop];
        }
    }
}

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

// return the highest x and y that a node is placed at
function getNodesDimensions(dataset) {
 //   startForce();
    var maxPointX = 0;
    var maxPointY = 0;
    for (var index in dataset.nodes) {
        
        // save max point so we can calculate our tapestry width and height
        if (dataset.nodes[index].x > maxPointX) {
            maxPointX = dataset.nodes[index].x;
        }
        if (dataset.nodes[index].y > maxPointY) { 
            maxPointY = dataset.nodes[index].y;
        }
    }

    return {
        'x': maxPointX + MAX_RADIUS,
        'y': maxPointY + MAX_RADIUS
    };
}

/* Gets the boundary of the tapestry */
function getTapestryDimensions() {

    var nodeDimensions = getNodesDimensions(originalDataset);
    var tapestryWidth = nodeDimensions.x;
    var tapestryHeight = nodeDimensions.y;

    var tapestryViewportWidth = getBrowserWidth() - $('#'+TAPESTRY_CONTAINER_ID).offset().left;
    var tapestryViewportHeight = getBrowserHeight() - $('#'+TAPESTRY_CONTAINER_ID).offset().top;

    var tapestryAspectRatio = nodeDimensions.x / nodeDimensions.y;
    var tapestryBrowserRatio = tapestryWidth / tapestryViewportWidth;

    if (tapestryHeight > tapestryViewportHeight && tapestryAspectRatio < 1) {
        tapestryWidth *= tapestryHeight/tapestryViewportHeight / tapestryBrowserRatio;
    }

    if (tapestryViewportHeight < tapestryHeight) {
        var scaleRatio = tapestryViewportHeight / tapestryHeight;
        tapestryWidth /= scaleRatio;
    }

    // var tapestryViewportWidth = getBrowserWidth() - $('#'+TAPESTRY_CONTAINER_ID).offset().left;
    // var tapestryViewportHeight = getBrowserHeight() - $('#'+TAPESTRY_CONTAINER_ID).offset().top;

    // Set to be at least the size of the browser
    if (tapestryWidth < tapestryViewportWidth) {
        tapestryWidth = tapestryViewportWidth;
    }
    if (tapestryHeight < tapestryViewportHeight) {
        tapestryHeight = tapestryViewportHeight;
    }

    // Set to be at least the size of the SVG
    if (document.getElementById("tapestry-svg") !== null) {
        if (tapestryWidth < screenToSVG(tapestryViewportWidth, 0).x) {
            tapestryWidth = screenToSVG(tapestryViewportWidth, 0).x;
        }

        if (tapestryHeight < screenToSVG(0, tapestryViewportHeight - $("#footer").height()).y) {
            tapestryHeight = screenToSVG(0, tapestryViewportHeight - $("#footer").height()).y;
        }
    }
    return {
        'width': tapestryWidth,
        'height': tapestryHeight
    };
}

/* Updates the size of the overall tapestry
(ie: the area that encompasses the boundaries of the nodes)
 according to where the nodes are placed in the dataset */
function updateTapestrySize() {
    if (!inViewMode) {
        var nodeDimensions = getNodesDimensions(dataset);

        // Transpose the tapestry so it's longest side is aligned with the longest side of the browser
        // For example, vertically long tapestries should be transposed so they are horizontally long on desktop,
        // but kept the same way on mobile phones where the browser is vertically longer
        var tapestryAspectRatio = nodeDimensions.x / nodeDimensions.y;
        var windowAspectRatio = getAspectRatio();
        if (tapestryAspectRatio > 1 && windowAspectRatio < 1 || tapestryAspectRatio < 1 && windowAspectRatio > 1) {
            transposeNodes();
        }

        // Update svg dimensions to the new dimensions of the browser
        updateSvgDimensions(TAPESTRY_CONTAINER_ID);
    }
    startForce();
}

/* Changes the node depending on horizontal/vertical view */
function transposeNodes() {
    for (var index in dataset.nodes) {
        var temp_fx = dataset.nodes[index].y;
        dataset.nodes[index].y = dataset.nodes[index].x;
        dataset.nodes[index].x = temp_fx;
    }
}

/* Finds the node index with node ID */
function findNodeIndex(id) {
    function helper(obj) {
        return obj.id == id;
    }

    return dataset.nodes.findIndex(helper);
}

/* Gets a node in the dataset by ID */
function getNodeById(id) {
    return dataset.nodes.find(node => node.id === id);
}

function getBoundedCoord(coord, maxCoord) {
    return Math.max(MAX_RADIUS, Math.min(maxCoord - MAX_RADIUS, coord));
}

/* Add 'depth' parameter to each node recursively. 
   The depth is determined by the number of levels from the root each node is. */

function addDepthToNodes(id, depth, visited) {
    visited.push(id);

    var depthAt = 0;

    dataset.nodes[findNodeIndex(id)].depth = depth;
    var children = getChildren(id, 1);

    var childLevel;

    // Progress through every child at a given node one at a time:
    while (depthAt < children.length) {
        for (var childId in children) {
            // if the child has been visited, check to make sure the calculated depth
            // is as low as it can be (via childLevel) to correct for shorter paths
            // to the same node.
            if (visited.includes(children[childId])) {
                childLevel = depth;
                if (dataset.nodes[findNodeIndex(children[childId])].depth > childLevel) {
                    dataset.nodes[findNodeIndex(children[childId])].depth = childLevel;
                }
                else {
                    depthAt++;
                }
            }
            // If the child has not been visited, record its depth (one away from the
            // current node's childLevel), and recursively add depth to all of the 
            // child's children.
            else {
                childLevel = depth + 1;
                dataset.nodes[findNodeIndex(children[childId])].depth = childLevel;
                visited.push(children[childId]);

                addDepthToNodes(children[childId], childLevel, visited);
                depthAt++;
            }
        }
    }
    
}

/* Return the distance between a node and its farthest descendant node */

function findMaxDepth(id) {

    if ((dataset && dataset.nodes.length === 0) || !id)  {
        return 0;
    } else {
        // Create the .depth parameter for every node
        addDepthToNodes(id, 0, []);
    }

    var nodes = dataset.nodes;

    // idList: collect node IDs since they're numbered dynamically
    var idList = [];
    for (var count = 0; count < nodes.length; count++) {
        idList = idList.concat(nodes[count].id);
    }

    // cycle through the idList and find the greatest depth. that's the maxDepth
    var maxDepth = 0;
    idList.forEach(function(id) {
        if (dataset.nodes[findNodeIndex(id)].depth > maxDepth) {
                maxDepth = dataset.nodes[findNodeIndex(id)].depth;
            }
    });

    return maxDepth;
}

/* Find children based on depth. 
   depth = 0 returns node + children, depth = 1 returns node + children + children's children, etc. */

function getChildren(id, depth) {
    if (typeof depth === 'undefined') {
        depth = tapestryDepth;
    }
    
    var children = [];
    var dataLinks = dataset.links;
    for (step = 0; step < depth; step++) {
        for (var linkId in dataLinks) {
            var link = dataLinks[linkId];

            // search for links
            if (typeof link.source === 'number' && link.source === id) {
                children.push(link.target);
                children = children.concat(getChildren(link.target, depth-1));
            }
            else if (typeof link.source === 'object' && link.source.id === id) {
                children.push(link.target.id);
                children = children.concat(getChildren(link.target.id, depth-1));
            }

            // account for links where the ID is the target.
            if (typeof link.target === 'number' && link.target === id) {
                children.push(link.source);
                children = children.concat(getChildren(link.source, depth-1));
            }
            else if (typeof link.target === 'object' && link.target.id === id) {
                children.push(link.source.id);
                children = children.concat(getChildren(link.source.id, depth-1));
            }
        }
    }
    // clear out duplicate IDs
    var rchildren = arrayRemove(children, id);
    return rchildren;
}

/* Remove any duplicates in an array. */
function arrayRemove(arr, value) {
    return arr.filter(function(ele){
        return ele != value;
    });
}

/* Gets the size of the node depending on the type of the node relevant to the current root */
function getRadius(d) {
    var radius;
    if (d.nodeType === "") {
        return 0;
    } else if (d.nodeType === "root") {
        radius = NORMAL_RADIUS * adjustedRadiusRatio + ROOT_RADIUS_DIFF;
    } else if (d.nodeType === "grandchild") {
        radius = NORMAL_RADIUS + GRANDCHILD_RADIUS_DIFF;
    } else {
        radius = NORMAL_RADIUS * adjustedRadiusRatio;
    }
    return radius;
}

/* Updates the data in the node for how much the video has been viewed */
function updateViewedValue(id, amountViewedTime, duration) {
    var amountViewed = amountViewedTime / duration;
    var amountUnviewed = 1.00 - amountViewed;

    var index = findNodeIndex(id);

    //Update the dataset with new values
    dataset.nodes[index].typeData.progress[0].value = amountViewed;
    dataset.nodes[index].typeData.progress[1].value = amountUnviewed;

    var progressObj = JSON.stringify(getDatasetProgress());
    if (saveProgress) {
        
        // Save to database if logged in
        if (tapestryWpUserId) {
            // Send save progress requests 5 seconds after the last time saved
            var secondsDiff = Math.abs((new Date().getTime() - progressLastSaved.getTime()) / 1000);
            if (secondsDiff > TIME_BETWEEN_SAVE_PROGRESS) {
                if (id) {
                    var progData = {
                        "post_id": tapestryWpPostId,
                        "node_id": id,
                        "progress_value": amountViewed
                    };
                    jQuery.post(TAPESTRY_PROGRESS_URL, progData, function(result) {})
                    .fail(function(e) {
                        console.error("Error with adding progress data");
                        console.error(e);
                    });
                }

                if (h5pVideoSettings && !isEmptyObject(h5pVideoSettings)) {
                    var h5pData = {
                        "post_id": tapestryWpPostId,
                        "json": JSON.stringify(h5pVideoSettings)
                    };
                    jQuery.post(TAPESTRY_H5P_SETTINGS_URL, h5pData, function(result) {})
                    .fail(function(e) {
                        console.error("Error with adding h5p video settings");
                        console.error(e);
                    });
                }
                progressLastSaved = new Date();
            }
        } else {
            // Set Cookies if not logged in
            Cookies.set("progress-data-"+tapestrySlug, progressObj);
            Cookies.set("h5p-video-settings", h5pVideoSettings);
        }

    }
}

/* Tells the overall dataset progress of the entire tapestry */
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
    var children = getChildren(root, tapestryDepth - 1),
        grandchildren = getChildren(root);

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
    var children = getChildren(root, tapestryDepth - 1),
        grandchildren = getChildren(root);

    for (var i in dataset.links) {
        var link = dataset.links[i];
        var targetId = link.target.id;

        // If unlocked, set proper link type. Else, set it as "" to present that it shouldn't be shown
        var parentIndex = findNodeIndex(dataset.links[i].source.id);
        if (dataset.links[i].appearsAt && dataset.links[i].appearsAt <= (dataset.nodes[parentIndex].typeData.progress[0].value * dataset.nodes[parentIndex].mediaDuration)) {
            if (targetId === root) {
                link.type = "root";
            } else if (children.indexOf(targetId) > -1) {
                link.type = "child";
            } else if (grandchildren.indexOf(targetId) > -1) {
                link.type = "grandchild";
            } else {
                link.type = "";
            }
        } else {
            link.type = "";
        }
    }
}

/* For setting the "unlocked" field of nodes.typeData in dataset or a specific node (if a parameter is passed in) */
function setUnlocked(childIndex) {
    if (typeof childIndex === 'undefined') {
        var parentIndex;
        for (var i = 0; i < dataset.links.length; i++) {
            childIndex = findNodeIndex(dataset.links[i].target.id);
            parentIndex = findNodeIndex(dataset.links[i].source.id);
            // TODO move unlocked out of typeData
            if (dataset.links[i].appearsAt <= (dataset.nodes[parentIndex].typeData.progress[0].value * dataset.nodes[parentIndex].mediaDuration)) {
                dataset.nodes[childIndex].typeData.unlocked = true;
                // TODO: this should only affect this user's tapestry, not saved to the base tapestry
                // $.ajax({
                //     url: apiUrl + "/tapestries/" + tapestryWpPostId + "/nodes/" + dataset.nodes[childIndex].id + "/typeData",
                //     method: 'PUT',
                //     data: JSON.stringify(dataset.nodes[childIndex].typeData),
                //     success: function(result) {
                //     },
                //     error: function(e) {
                //         console.error("Error with update node's unlock property");
                //         console.error(e);
                //     }
                // });
            }
        }
    }
    else {
        // TODO move unlocked out of typeData
        dataset.nodes[childIndex].typeData.unlocked = true;
        $.ajax({
            url: apiUrl + "/tapestries/" + tapestryWpPostId + "/nodes/" + dataset.nodes[childIndex].id + "/typeData",
            method: 'PUT',
            data: JSON.stringify(dataset.nodes[childIndex].typeData),
            success: function(result) {
            },
            error: function(e) {
                console.error("Error with update node's unlock property");
                console.error(e);
            }
        });
    }
    setAccessibleStatus();
}

/**
 * Recursively sets the accessible status of the given node and its children up to the given depth
 * @param {object} node 
 * @param {integer} depth 
 */
function setAccessibleStatus(node, depth, parentNodeId, parentIsAccessible = true){

    // If no node passed in, assume root node
    if (typeof node == "undefined") {
        node = dataset.nodes[findNodeIndex(dataset.rootId)];
    }

    // If no node passed in, assume tapestry depth
    if (typeof depth == "undefined") {
        depth = tapestryDepth;
    }

    getChildren(node.id, 1).forEach (childNodeId => {
        var thisNode = getNodeById(childNodeId);
        // Do not traverse up the parent
        if (parentNodeId != thisNode.id) {
            // If a node is accessible, only if it's unlocked and its parent is accessible
            var isAccessible = thisNode.typeData.unlocked && parentIsAccessible;
            dataset.nodes[findNodeIndex(thisNode.id)].accessible = isAccessible;
            if (depth > 0) {
                // Keep going deeper in
                setAccessibleStatus(thisNode, depth-1, node.id, isAccessible);
            }
        }
    });
}

// ALL the checks for whether a certain node is viewable
function getViewable(node) {

    // TODO: CHECK 1: If user is authorized to view it

    // CHECK 2: Always show root node
    if (node.nodeType === "root") return true;

    // CHECK 3: If the user has unlocked the node
    if (!node.accessible && !viewLockedCheckbox.checked) return false;

    // CHECK 4: If the node is currently in view (ie: root/child/grandchild)
    if (node.nodeType === "") return false;

    // CHECK 5: If we are currently in view mode & if the node will be viewable in that case
    if (node.nodeType === "grandchild" && inViewMode) return false;

    // If it passes all the checks, return true!
    return true;
}

// For saving the coordinates of all the nodes prior to transitioning to play-mode
function saveCoordinates() {
    for (var i in dataset.nodes) {
        var node = dataset.nodes[i];
        var id = node.id;
        nodeCoordinates[id] = {
            "x": node.x, // fx & fy - ford
            "y": node.y
        };
    }
}

// Get data from child needed for knowing whether it is unlocked or not
function getChildrenData(parentId) {
    var childrenData = [];
    for (var i = 0; i < dataset.links.length; i++) {
        var source = typeof dataset.links[i].source === 'object' ? dataset.links[i].source.id : dataset.links[i].source;
        if (source == parentId) {
            childrenData.push({
                "id": dataset.links[i].target.id,
                "nodeIndex": findNodeIndex(dataset.links[i].target.id),
                "appearsAt": dataset.links[i].appearsAt
            });
        }
    }

    return childrenData;
}

})();

// Functionality for the X button that closes the media and the light-box
function closeLightbox(id, mediaType) {
    	
    // Pause the H5P video before closing it. This will also trigger saving of the settings
    // TODO: Do this for HTML5 video as well
    // var h5pObj = document.getElementById('h5p').contentWindow.H5P;
    // if (h5pObj !== undefined && mediaType == "video") {
		// var h5pVideo = h5pObj.instances[0].video;
		// h5pVideo.pause();
    // }

    if (document.getElementById('h5p') !== null) {
        var h5pObj = document.getElementById('h5p').contentWindow.H5P;
        if (h5pObj !== undefined && mediaType == "video") {
            var h5pVideo = h5pObj.instances[0].video;
            h5pVideo.pause();
        }
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
    var classStr = getIconClass(mediaType, action);

    $(buttonElementId).removeAttr('style');
    $(buttonElementId).attr('class', classStr);
}

// Helper function for getting the name for the Font Awesome icons
function getIconClass(mediaType, action) {

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

        case "add":
            classStr = classStrStart + 'plus' + classStrEnd;
            break;
            
        default:
            classStr = classStrStart + 'exclamation' + classStrEnd;
            break;
    }

    return classStr;
}

// Helper for converting the screen coordinates to SVG coordinates
function screenToSVG(screenX, screenY) {
    var svg = document.getElementById("tapestry-svg");
    var p = svg.createSVGPoint();
    p.x = screenX;
    p.y = screenY;
    return p.matrixTransform(svg.getScreenCTM().inverse());
}

/****************************************************
 * ANALYTICS FUNCTIONS
 ****************************************************/

var analyticsAJAXUrl = '',  // e.g. '/wp-admin/admin-ajax.php' (set to empty string to disable analytics)
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

function isEmptyObject(obj) {
    for(var key in obj) {
        if(obj.hasOwnProperty(key))
            return false;
    }
    return true;
}

function onlyContainsDigits(string) {
    var regex = new RegExp(/^\d+$/); 
    return regex.test(string);
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