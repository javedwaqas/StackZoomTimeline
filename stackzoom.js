/* ------------------------------------------------------------------
 * stackzoom.js
 * 
 * Created 2010-04-20 by Waqas Javed and Niklas Elmqvist.
 * ------------------------------------------------------------------
 */

// Declare a unique namespace
var pivot = {};
pivot.paper = {};
pivot.container = {};
pivot.options = {};

pivot.bind = function(target, type, binder) {
	return target.addEventListener
		? target.addEventListener(type, binder, false)
	    : target.attachEvent("on" + type, binder);
};

pivot.unbind = function(target, type, binder) {
	return target.removeEventListener
		? target.removeEventListener(type, binder, false)
	    : target.detachEvent("on" + type, binder);
};

var pageX = 0, pageY = 0;

pivot.bind(window, "mousemove", function(e) {
	pageX = e.pageX;
	pageY = e.pageY;
});

pivot.mouse = function() {
	return {x: pageX - pivot.container.offsetLeft, y: pageY - pivot.container.offsetTop}; 
};

pivot.randomColor = function() {
	return "rgb(" + Math.floor(256 * Math.random()) + "," + Math.floor(256 * Math.random()) + "," + Math.floor(256 * Math.random()) + ")";
};

pivot.differentOrder = function(last, curr) {
	if (last.length != curr.length) return true;
	for (var i = 0; i < last.length; i++) {
		if (last[i].col != curr[i].col) return true;
	}
	return false;
};

pivot.createLinePath = function(data, segment, viewport, valCol, extrema) { 
	var xStep = viewport.width / (segment.end - segment.start);
	var pathString = "M " + viewport.x + " " + (viewport.y + viewport.height);

	// Step through the rows in the data table
	var diff = extrema.max - extrema.min;
	for (var row = segment.start; row <= segment.end; row++) {
		var value = data.getValue(row, valCol);
		var pos = row - segment.start;
		pathString += " L " + (pos * xStep + viewport.x) + " " + (viewport.y + viewport.height * (1.0 - (value - extrema.min) / diff));   
	}
	pathString += "L " + (viewport.x + viewport.width) + " " + (viewport.y + viewport.height - 1);
	return pathString;
};

pivot.sortOrder = function(positions) { 
	positions.sort(function (a, b) { return a.value - b.value; });
};

pivot.drawBraidedGraphs = function(data, segment, viewport, color, normalize) {
	
	var colors = ["pink", "lightgreen", "lightblue", "mediumpurple", "lightcyan", "gray", "orange", "lightbrown"];
	var numSubGraphs = data.getNumberOfColumns() - 1; 
	
	// Create the array containing the graphs
	var gs = new Array();

	// Calculate horizontal step per row 
	var xStep = viewport.width / (segment.end - segment.start);
	
	// Compute a global range
	var globalRange = {min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY};
	for (var i = 0; i < numSubGraphs; i++) {
		var currRange = data.getColumnRange(i + 1);
		globalRange = {min: Math.min(currRange.min, globalRange.min), max: Math.max(currRange.max, globalRange.max)};
	}
	
	// Initialize orders and shape strings
	var currPos = [];
	var lastPos = [];
	var ranges = [];
	var pathStrings = [];
	var range, value, path, col;
	for (i = 0; i < numSubGraphs; i++) {
		range = normalize ? globalRange : data.getColumnRange(i + 1);
		range.diff = range.max - range.min;
		ranges.push(range);
		value = data.getValue(segment.start, i + 1);
		lastPos.push({col: i, value: viewport.y + viewport.height * (1.0 - (value - range.min) / range.diff)});
		pathStrings.push({col: i, path: "M " + viewport.x + " " + (viewport.y + viewport.height)});
	}
	pivot.sortOrder(lastPos);
	
	// Now step through the segment
	for (var row = segment.start; row <= segment.end; row++) {

		// Figure out series order
		var pos = row - segment.start;
		
		// Calculate Y values for each column
		currPos = [];
		for (i = 0; i < numSubGraphs; i++) {
			range = ranges[i];
			value = data.getValue(row, i + 1);
			currPos.push({col: i, value: viewport.y + viewport.height * (1.0 - (value - range.min) / range.diff)});
			pathStrings[i].path += " L " + (pos * xStep + viewport.x) + " " + currPos[i].value;
		}

		// Sort columns in order
		pivot.sortOrder(currPos);
		
		// Did the ordering change?
		if (pivot.differentOrder(currPos, lastPos)) {
			
			// Add the strings
			for (i = 0; i < numSubGraphs; i++) {
				pathStrings[i].path += " L " + (pos * xStep + viewport.x) + " " + (viewport.y + viewport.height); 
			}
			
			// Finish the shapes in the correct order
			for (i = 0; i < numSubGraphs; i++) {
				col = lastPos[i].col;
				path = pivot.paper.path(pathStrings[col].path);
				path.attr({fill: colors[col % colors.length], "stroke-opacity": 0});
				gs.push(path);
				var newCol = 0;
				for (var x = 0; x < numSubGraphs; x++) {
					if (currPos[x].col == col) {
						newCol = x;
						break;
					}
				}
				pathStrings[col].path  = "M " + (pos * xStep + viewport.x) + " " + (viewport.y + viewport.height); 
				pathStrings[col].path += " L " + (pos * xStep + viewport.x) + " " + currPos[newCol].value; 
			}

			// Save new positions
			lastPos = currPos;
		}
	}
	
	// Handle the trailing shapes in the correct order
	for (i = 0; i < numSubGraphs; i++) {
		col = lastPos[i].col;
		path = pivot.paper.path(pathStrings[col].path + " L " + (pos * xStep + viewport.x) + " " + (viewport.y + viewport.height));
		path.attr({fill: colors[col % colors.length], "stroke-opacity": 0});
		gs.push(path);
	}

	return gs; 
};

pivot.classifyHorizon = function(value, midPoint, band, bandSize) {
	var positive = true;
	var normValue = Math.abs(value - midPoint) - band * bandSize;
	if (value < midPoint) positive = false;
	var inside = normValue > 0.0;
	return {value: normValue, positive: positive, inside: inside};
};

pivot.drawHorizonGraph = function(data, valCol, segment, viewport, extrema, midPoint, numBands) {

	var posColor = "#0063b8";
	var negColor = "#b41512";
	
	// Create the set containing the pieces of the graph
	var graphs = new Array();
	
	var xStep = viewport.width / (segment.end - segment.start);

	// Figure out band size
	var bandSize = Math.max(extrema.max - midPoint, midPoint - extrema.min) / numBands;
	
	// Step through bands
	for (var band = 0; band < numBands; band++) {

		// Figure out levels
		var currBand = midPoint + band * bandSize;
		var nextBand = currBand + bandSize;

		// Initialize the classification
		var last = pivot.classifyHorizon(data.getValue(segment.start, valCol), midPoint, band, bandSize);
		var pathString = "M " + viewport.x + " " + (viewport.y + viewport.height);
		
		// Now step through the segment
		for (var row = segment.start; row <= segment.end; row++) {
			
			var path, xSplit;
			
			// Center and mirror around the midpoint
			var pos = row - segment.start;
			var cp = pivot.classifyHorizon(data.getValue(row, valCol), midPoint, band, bandSize);
			
			// Did we switch?    
			if (last.positive != cp.positive) {
				
				xSplit = last.value / (last.value + cp.value);
				if ((last.value + cp.value) == 0) xSplit = 0.5;
			
				pathString += " L " + ((pos - 1 + xSplit) * xStep + viewport.x) + " " + (viewport.y + viewport.height);
				path = pivot.paper.path(pathString);
				path.attr({fill: last.positive ? posColor : negColor, "fill-opacity": (1.0 / numBands), "stroke-opacity": 0});
				graphs.push(path);
				
				pathString = "M " + ((pos - 1 + xSplit) * xStep + viewport.x) + " " + (viewport.y + viewport.height);
			}
			
			// Case 1: We are no longer inside -> segment ends
			if (last.inside && !cp.inside) {
				xSplit = last.value / (last.value + cp.value);
				if ((last.value + cp.value) == 0) xSplit = 0.5;
				
				pathString += " L " + ((pos - 1 + xSplit) * xStep + viewport.x) + " " + (viewport.y + viewport.height);
				path = pivot.paper.path(pathString);
				path.attr({fill: last.positive ? posColor : negColor, "fill-opacity": (1.0 / numBands), "stroke-opacity": 0});
				graphs.push(path);
			}
			
			// Case 2: We are now inside -> segment begins
			if (!last.inside && cp.inside) {
				xSplit = last.value / (last.value + cp.value);
				if ((last.value + cp.value) == 0) xSplit = 0.5;
				pathString = "M " + ((pos - 1 + xSplit) * xStep + viewport.x) + " " + (viewport.y + viewport.height);
			}
			
			// If we are inside, add a segment
			if (cp.inside) { 
				var value = cp.value;
				if (value > bandSize) value = bandSize;
				pathString += " L " + (pos * xStep + viewport.x) + " " + (viewport.y + viewport.height * (1.0 - value / bandSize));   
			}
			
			// Save last value
			last = cp;
		}

		// Handle trailing shape
		pathString += " L " + (pos * xStep + viewport.x) + " " + (viewport.y + viewport.height);
		path = pivot.paper.path(pathString);
		path.attr({fill: last.positive ? posColor : negColor, "fill-opacity": (1.0 / numBands), "stroke-opacity": 0});
		graphs.push(path);
	}

	return graphs;
};

pivot.drawHorizonGraphs = function(data, segment, viewport, color, normalize) {
	
	// Figure out the size allocation for each subgraph
	var numSubGraphs = data.getNumberOfColumns() - 1; 
	var subGraphHeight = viewport.height / numSubGraphs;
	
	// Create the set containing the graphs
	var gs = new Array();
	
	// Compute a global range
	var globalRange = {min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY};
	for (var i = 0; i < numSubGraphs; i++) {
		var currRange = data.getColumnRange(i + 1);
		globalRange = {min: Math.min(currRange.min, globalRange.min), max: Math.max(currRange.max, globalRange.max)};
	}
	
	// Create each graph separately
	for (i = 0; i < numSubGraphs; i++) {
		var subGraphViewport = {x: viewport.x, y: viewport.y + i * subGraphHeight, width: viewport.width, height: subGraphHeight};
		var range = normalize ? globalRange : data.getColumnRange(i + 1);
		var midPoint = (range.max + range.min) / 2.0;
		var path = pivot.drawHorizonGraph(data, i + 1, segment, subGraphViewport, range, midPoint, pivot.options.numBands || 2);
		for (var j = 0; j < path.length; j++) { 
			gs.push(path[j]);
		}
	}

	return gs;
};

pivot.drawLineGraphs = function(data, segment, viewport, color, normalize) {
	var colors = ["red", "green", "blue", "purple", "cyan", "black", "orange", "brown"];
	var numSubGraphs = data.getNumberOfColumns() - 1; 
	
	// Create the set containing the graphs
	var graphSet = pivot.paper.set();
	
	// Compute a global range
	var globalRange = {min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY};
	for (var i = 0; i < numSubGraphs; i++) {
		var currRange = data.getColumnRange(i + 1);
		globalRange = {min: Math.min(currRange.min, globalRange.min), max: Math.max(currRange.max, globalRange.max)};
	}
	
	// Create each graph separately
	for (i = 0; i < numSubGraphs; i++) {
		var currColor = colors[i % colors.length];
		var pathString = pivot.createLinePath(data, segment, viewport, i + 1, normalize ? globalRange : data.getColumnRange(i + 1));
		var path = pivot.paper.path(pathString);
		path.attr({"stroke-width": 2, stroke: currColor}); 
		graphSet.push(path);
	}

	return graphSet; 
};

pivot.drawSmallMultiples = function(data, segment, viewport, color, normalize) {
	
	// Figure out the size allocation for each subgraph
	var numSubGraphs = data.getNumberOfColumns() - 1; 
	var subGraphHeight = viewport.height / numSubGraphs;
	
	// Create the set containing the graphs
	var graphSet = pivot.paper.set();
	
	// Compute a global range
	var globalRange = {min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY};
	for (var i = 0; i < numSubGraphs; i++) {
		var currRange = data.getColumnRange(i + 1);
		globalRange = {min: Math.min(currRange.min, globalRange.min), max: Math.max(currRange.max, globalRange.max)};
	}
	
	// Create each graph separately
	for (i = 0; i < numSubGraphs; i++) {
		var subGraphViewport = {x: viewport.x, y: viewport.y + i * subGraphHeight, width: viewport.width, height: subGraphHeight};
		var pathString = pivot.createLinePath(data, segment, subGraphViewport, i + 1, normalize ? globalRange : data.getColumnRange(i + 1));
		var path = pivot.paper.path(pathString);
		path.attr({"stroke-width": 2, stroke: color, fill: color, "fill-opacity": 0.25});
		graphSet.push(path);
	}

	return graphSet; 
};

pivot.StackZoomSegment = function(timeline, parent, segment, layout) {
	this.timeline = timeline;
	this.parent = parent;
	this.layer = (parent && parent.layer + 1) || 0;
	this.segment = segment;
	this.layout = layout;
	this.data = timeline.data;
	this.children = new Array();
};

pivot.StackZoomSegment.prototype.visitChildren = function(visit) {
	visit(this);
	for (var i = 0; i < this.children.length; i++) {
		var child = this.children[i];
		child.visitChildren(visit);
	}
};

pivot.StackZoomSegment.prototype.createSelectionArea = function(child) {
	
	var segment = this;
	var viewport = this.viewport;
	var xStep = viewport.width / (this.segment.end - this.segment.start - 1);	
	var distToParent = child.segment.start - this.segment.start;
	var childSegWidth = child.segment.end - child.segment.start;
	var dim = {x: xStep * distToParent + viewport.x, y: viewport.y, width: xStep * childSegWidth, height: viewport.height};
	
	var childRect = pivot.paper.rect(dim.x, dim.y, dim.width, dim.height);
	childRect.attr({stroke: child.color, fill: child.color, "fill-opacity": 0.2, "stroke-opacity": 0.8});

	var pan = false;
	var panMouseDown = function(event) {
		if (event.button != 0) return true;
		pan = childRect.attr("fill", "yellow");
		var lastX = pivot.mouse().x;		
		var x = parseInt(pan.node.getAttribute('x'));
		var width = parseInt(pan.node.getAttribute('width'));
		document.body.style.cursor = 'w-resize';

		var mousemove = function() {
			var diff = pivot.mouse().x - lastX;
			x += diff;			
			if (x < viewport.x) { 
				x = viewport.x;
			}
			if (x + width > viewport.x + viewport.width) {
				x = viewport.x + viewport.width - width;
			}
			lastX = pivot.mouse().x;
			pan.attr({x: x });		
			return false;
		};
		
		var mouseup = function() {
			
			// Unbind temporary handlers
			pivot.unbind(document, "mousemove", mousemove);
			pivot.unbind(document, "mouseup", mouseup);
			
			// Update the child
			var segWidth = segment.segment.end - segment.segment.start;	
			var segStart = Math.floor(segWidth * (x - viewport.x) / viewport.width + segment.segment.start);
			var segEnd = Math.floor(segWidth * (x + width - viewport.x) / viewport.width + segment.segment.start);

			// Sanity checks
			if (segStart < 0) segStart = 0;
			if (segEnd > segment.data.getNumberOfRows() - 1) segEnd = segment.data.getNumberOfRows() - 1;
			if (segEnd - segStart <= 2) segEnd = segStart + 2;
	
			// Update the segment
			child.segment = {start: segStart, end: segEnd};
			
			// Update the canvas
			pivot.paper.clear();
			segment.layout.draw();
			document.body.style.cursor = 'default';
			pan = false;
	
			return false;
		};
		
		// Wait for mouse movement or mouse up
		pivot.bind(document, "mousemove", mousemove);
		pivot.bind(document, "mouseup", mouseup);
		
		return false;
	};
	pivot.bind(childRect.node, "mousedown", panMouseDown);

	// Highlight children
	pivot.bind(childRect.node, "mouseover", function() {
		if (pan) return false;
		document.body.style.cursor = 'w-resize';
		child.visitChildren(function(s) { s.rect.attr("fill", s.timeline.highlightColor); });
	});
	pivot.bind(childRect.node, "mouseout", function() {
		if (pan) return false;
		document.body.style.cursor = 'default';
		child.visitChildren(function(s) { s.rect.attr("fill", s.timeline.backgroundColor); });
	});
};

pivot.StackZoomSegment.prototype.draw = function(viewport) {
	
	var segment = this;
	this.viewport = viewport;
	
	var selectMouseDown = function(event) {
		if (event.button != 0) return true;
		var drag = pivot.paper.rect(pivot.mouse().x + viewport.x, viewport.y, 1, viewport.height);
		drag.attr({ fill: "blue", stroke: "blue", "fill-opacity": 0 }).animate({"fill-opacity": 0.2}, 500);
		var startX = x = pivot.mouse().x;
		var width = 1;
		document.body.style.cursor = 'w-resize';
		
		var mousemove = function() {
			if (!drag) return true;
			x = Math.min(pivot.mouse().x, startX);
			width = Math.abs(pivot.mouse().x - startX);
			if (x < viewport.x) {
				width -= viewport.x - x;
				x = viewport.x;
			}
			if (x + width > viewport.x + viewport.width) {
				width = viewport.x + viewport.width - x;
			}
			drag.attr({x: x, width: width});		
			return false;
		}
		var mouseup = function() {

			// Unbind temporary handlers
			pivot.unbind(document, "mousemove", mousemove);
			pivot.unbind(document, "mouseup", mouseup);
			
			// Figure out the data coordinates
			var segWidth = segment.segment.end - segment.segment.start;	
			var segStart = Math.floor(segWidth * (x - viewport.x) / viewport.width + segment.segment.start);
			var segEnd = Math.floor(segWidth * (x + width - viewport.x) / viewport.width + segment.segment.start);
			
			// Sanity checks
			if (segStart < 0) segStart = 0;
			if (segEnd > segment.data.getNumberOfRows() - 1) segEnd = segment.data.getNumberOfRows() - 1;
			if (segEnd - segStart <= 2) segEnd = segStart + 2;
	
			// Create the segment
			segment.layout.addChild(segment, {start: segStart, end: segEnd});
			pivot.paper.clear();
			segment.layout.draw();
			document.body.style.cursor = 'default';
			drag = false;
			return true;
		}
		
		// Wait for mouse movement or mouse up
		pivot.bind(document, "mousemove", mousemove);
		pivot.bind(document, "mouseup", mouseup);
		return false;
	}
		
	// Create the viewport	
	this.rect = pivot.paper.rect(viewport.x, viewport.y, viewport.width - 1, viewport.height - 1);
	this.rect.attr("fill", this.timeline.backgroundColor);
	pivot.bind(this.rect.node, "mousedown", selectMouseDown);
	
	// Create the graphs
//	var graph = pivot.drawSmallMultiples(this.data, this.segment, viewport, this.timeline.color, this.timeline.normalize);
	var graph = this.timeline.visual(this.data, this.segment, viewport, this.timeline.color, this.timeline.normalize);
	for (var i = 0; i < graph.length; i++) {
		pivot.bind(graph[i].node, "mousedown", selectMouseDown);
	}
	
	/*
	var hover = {};
	var drillUpdate = function() {
		var diffY = pivot.mouse().y - hover.last.y;
		hover.translate(0, diffY);
		hover.last = pivot.mouse(); 
		return false;
	}
	var drillOut = function() {
		hover.remove();
		hover = false;
		pivot.unbind(path.node, "mousemove", drillUpdate);
		return false;
	}
	var drillOver = function() {
		hover = pivot.paper.path("M " + viewport.x + " 0 L " + (viewport.x + viewport.width) + " 0");
		hover.translate(0, pivot.mouse().y - 2);
		pivot.bind(hover.node, "mouseover, mouseout, mousemove", function (event) { event.preventDefault(); return true; });
		hover.last = pivot.mouse();
		pivot.bind(path.node, "mousemove", drillUpdate);
		return false;
	}
	pivot.bind(path.node, "mouseover", drillOver);
	pivot.bind(path.node, "mouseout", drillOut);
	*/
	
	// Now add selection regions
	for (var child = 0; child < this.children.length; child++) {
		var currChild = this.children[child];
		this.createSelectionArea(currChild);
	}
	
	// Create the decorations
	if (this.parent) {
		var crossSize = 10, crossPadding = 8;
		var cross = pivot.paper.path("M 0 0 L " + crossSize + " " + crossSize + " M 0 " + crossSize + " L " + crossSize + " 0").attr({stroke: "black", "stroke-width": 2});
		var crossBox = pivot.paper.rect(-crossPadding, -crossPadding, crossSize + 2 * crossPadding, crossSize + 2 * crossPadding).attr({"stroke-opacity": 0, fill: "white", "fill-opacity": 0.0});
		var crossButton = pivot.paper.set();
		crossButton.push(cross, crossBox);
		crossButton.translate(viewport.x + viewport.width - crossSize - crossPadding, viewport.y + crossPadding);
		
		var crossEnter = function(event) {
			crossButton.attr("stroke", "red");
			document.body.style.cursor = 'pointer';
			return false;
		};
		var crossLeave = function(event) { 
			crossButton.attr("stroke", "black");
			document.body.style.cursor = 'default';
			return false;
		};
		var crossClick = function(event) {
			segment.layout.removeChild(segment);
			pivot.paper.clear();
			segment.layout.draw();
			document.body.style.cursor = 'default';
			return false;
		};
		pivot.bind(crossBox.node, "mouseover", crossEnter);
		pivot.bind(crossBox.node, "mouseout", crossLeave);
		pivot.bind(crossBox.node, "click", crossClick);
	}
	
	// Draw a frame
	var frame = pivot.paper.rect(viewport.x, viewport.y, viewport.width - 1, viewport.height - 1);
	frame.attr("stroke", this.timeline.borderColor);
	if (this.parent) {  
		var colorWidth = 4;
		var colorFrame = pivot.paper.rect(viewport.x + colorWidth / 2, viewport.y + colorWidth / 2, viewport.width - 1 - colorWidth, viewport.height - 1 - colorWidth);
		colorFrame.attr({stroke: this.color, "stroke-width": colorWidth});
		var whiteFrame = pivot.paper.rect(viewport.x + colorWidth, viewport.y + colorWidth, viewport.width - 2 * colorWidth - 1, viewport.height - 2 * colorWidth - 1);
		whiteFrame.attr("stroke", "white");
	}
};

pivot.StackZoomLayout = function(timeline, data) {
	this.timeline = timeline;
	this.layers = new Array();
	var root = new pivot.StackZoomSegment(this.timeline, null, {start: 0, end: data.getNumberOfRows() - 1}, this);
	root.color = "black";
	this.layers[0] = [ root ];
};

pivot.StackZoomLayout.prototype.draw = function() {
	var numLayers = this.layers.length;
	var layerHeight = pivot.paper.height / numLayers;	
	for (var i = 0; i < numLayers; i++) {
		this.layers[i].sort(function (a, b) { return a.segment.start - b.segment.start});
		var numStrips = this.layers[i].length;
		var stripWidth = pivot.paper.width / numStrips;
		for (var j = 0; j < numStrips; j++) { 
			this.layers[i][j].draw({ x: j * stripWidth, y: i * layerHeight, width: stripWidth, height: layerHeight});
		}
	}
};

pivot.StackZoomLayout.prototype.addLayer = function() { 
	var newLayer = this.layers.push(new Array()) - 1;
	this.layers[newLayer].colors = ["red", "green", "blue", "purple", "cyan", "black", "orange", "brown"];
};

pivot.StackZoomLayout.prototype.addChild = function(parent, segment) {
	var newLayer = parent.layer + 1;
	if (!this.layers[newLayer]) this.addLayer();
	var child = new pivot.StackZoomSegment(this.timeline, parent, segment, this);
	child.color = this.layers[newLayer].colors.shift() || pivot.randomColor();
	this.layers[newLayer].push(child);
	parent.children.push(child);
};

pivot.StackZoomLayout.prototype.removeChild = function(child) {	
	if (child.parent == null) return;
	
	// Remove all children of this node
	while (child.children.length > 0) { 
		var currChild = child.children[0];
		this.removeChild(currChild);
	}
	
	// Now remove this child (remove whole layer if possible)
	child.parent.children.splice(child.parent.children.indexOf(child), 1);
	this.layers[child.layer].splice(this.layers[child.layer].indexOf(child), 1);
	this.layers[child.layer].colors.unshift(child.color);
	if (this.layers[child.layer].length == 0) {
		this.layers.pop();
	}
};

// Class constructor
pivot.StackZoomTimeline = function(container) { 
	pivot.container = container;
};

pivot.StackZoomTimeline.prototype.draw = function(data, options) {
	
	// Create canvas
	pivot.paper = Raphael(pivot.container, options.width || 400, options.height || 200);
	
	// Save the data too
	this.data = data;
	
	// Color mappings
	this.color = 			options.color || "#0000ff";
	this.backgroundColor = 	options.backgroundColor || "#ffffff";
	this.borderColor = 		options.borderColor || "#000000";
	this.highlightColor = 	options.highlightColor || "lightgoldenrodyellow";
	
	// Normalize scales across all ranges or not? 
	this.normalize = 		options.normalize || false;
	
	// How many bands for horizon graphs?
	pivot.options = options;
	
	// Visual representation
	switch (options.visual) {
	case 'filled':
		this.visual = pivot.drawSmallMultiples;
		break;
	case 'horizon':
		this.visual = pivot.drawHorizonGraphs;
		break;
	case 'braided':
		this.visual = pivot.drawBraidedGraphs;
		break;
	case 'line':
	default:
		this.visual = pivot.drawLineGraphs;
		break;
	}
	
	// Create and draw the initial layout
	this.layout = new pivot.StackZoomLayout(this, data);
	this.layout.draw();
};
