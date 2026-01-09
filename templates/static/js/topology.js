// Global variables
let nodes, edges, network;
let mode = "collapsed";
let expandedDevices = new Set();
let physicsEnabled = false; // Track physics state manually

// Layout configuration variables (accessible to all functions)
let layoutConfig = {
  numberOfRows: 2,
  portSpacing: 30,
  switchWidth: 0,
  deviceSpacing: 0,
  rowHeight: 70,
  deviceY: 300,
  rowYPositions: [], // Will be calculated based on numberOfRows
  startX: 200
};

function initTopology() {
  console.log('initTopology called');
  
  // Check if vis is available
  if (typeof vis === 'undefined') {
    console.error('vis-network library not loaded');
    document.getElementById("network").innerHTML = '<div style="padding: 20px; color: red;">Error: vis-network library failed to load. Please check your internet connection.</div>';
    return;
  }

  const networkContainer = document.getElementById("network");
  if (!networkContainer) {
    console.error('Network container not found');
    return;
  }

  console.log('Creating DataSets and Network...');
  nodes = new vis.DataSet([]);
  edges = new vis.DataSet([]);

  function createPhysicalPortView() {
    nodes.clear(); 
    // Don't clear edges yet - we'll add them after nodes are positioned
    edges.clear();
    
    // Verify we have all devices
    console.log('DATA.device_nodes:', DATA.device_nodes);
    console.log('Number of devices:', DATA.device_nodes ? DATA.device_nodes.length : 0);
    if (!DATA.device_nodes || DATA.device_nodes.length === 0) {
      console.error('No device nodes in DATA!');
      return;
    }
    
    // Layout configuration (store in global config object)
    // numberOfRows is now configurable via UI slider
    layoutConfig.portSpacing = 70; // Increased spacing to prevent port overlap (accounts for port size + label)
    layoutConfig.rowHeight = 70;
    layoutConfig.deviceY = 300; // Keep for reference, but not used for device node
    layoutConfig.startX = 200;
    
    // Calculate row Y positions based on number of rows
    const numberOfRows = layoutConfig.numberOfRows;
    const totalRowHeight = (numberOfRows - 1) * layoutConfig.rowHeight;
    const firstRowY = 250;
    layoutConfig.rowYPositions = [];
    for (let i = 0; i < numberOfRows; i++) {
      layoutConfig.rowYPositions.push(firstRowY + i * layoutConfig.rowHeight);
    }
    
    // Calculate switch width based on maximum ports in any row
    // We'll calculate this after distributing ports
    layoutConfig.switchWidth = 0; // Will be calculated per device
    layoutConfig.deviceSpacing = 0; // Will be calculated after determining max width
    
    // Use local variables for convenience
    const portSpacing = layoutConfig.portSpacing;
    const rowHeight = layoutConfig.rowHeight;
    const deviceY = layoutConfig.deviceY;
    const startX = layoutConfig.startX;
    // Note: deviceSpacing will be calculated later after determining max switch width
    
    // Analyze connections to determine optimal switch placement
    const connectionMatrix = {};
    const deviceNames = DATA.device_nodes.map(n => n.label);
    
    // Initialize connection matrix
    deviceNames.forEach(dev => {
      connectionMatrix[dev] = {};
      deviceNames.forEach(otherDev => {
        if (dev !== otherDev) {
          connectionMatrix[dev][otherDev] = 0;
        }
      });
    });
    
    // Count direct port-to-port connections
    (DATA.port_edges || []).forEach(e => {
      const dev1 = e.meta.a_dev;
      const dev2 = e.meta.b_dev;
      if (dev1 !== dev2 && connectionMatrix[dev1] && connectionMatrix[dev1][dev2] !== undefined) {
        connectionMatrix[dev1][dev2]++;
        connectionMatrix[dev2][dev1]++;
      }
    });
    
    // Count shared segment connections (weighted less than direct connections)
    const segConnections = {};
    (DATA.seg_edges || []).forEach(e => {
      const dev = e.meta.dev;
      const seg = e.meta.seg;
      if (!segConnections[seg]) segConnections[seg] = new Set();
      segConnections[seg].add(dev);
    });
    
    // Add segment connections to matrix (devices sharing a segment are connected)
    Object.values(segConnections).forEach(devices => {
      const deviceArray = Array.from(devices);
      for (let i = 0; i < deviceArray.length; i++) {
        for (let j = i + 1; j < deviceArray.length; j++) {
          const dev1 = deviceArray[i];
          const dev2 = deviceArray[j];
          if (connectionMatrix[dev1] && connectionMatrix[dev1][dev2] !== undefined) {
            connectionMatrix[dev1][dev2] += 0.5; // Weight segment connections less
            connectionMatrix[dev2][dev1] += 0.5;
          }
        }
      }
    });
    
    // Calculate total connection strength for each device
    const deviceConnections = {};
    deviceNames.forEach(dev => {
      deviceConnections[dev] = Object.values(connectionMatrix[dev] || {}).reduce((sum, count) => sum + count, 0);
    });
    
    console.log('Connection matrix:', connectionMatrix);
    console.log('Device connection strengths:', deviceConnections);
    
    // Sort devices by connection strength (most connected first)
    const sortedDevices = [...deviceNames].sort((a, b) => deviceConnections[b] - deviceConnections[a]);
    const mostConnected = sortedDevices[0];
    console.log('Most connected device:', mostConnected);
    console.log('Optimal device order (by connection strength):', sortedDevices);
    
    // Create a mapping from device name to optimal position index
    // Place most connected switch in the middle, directly connected switches adjacent to minimize cable length
    const deviceToIndex = {};
    const numDevices = sortedDevices.length;
    const middleIndex = Math.floor(numDevices / 2);
    
    // Place most connected device in the middle
    deviceToIndex[mostConnected] = middleIndex;
    
    // Find devices directly connected to the center device (via port_edges)
    const directlyConnected = [];
    const otherDevices = sortedDevices.filter(d => d !== mostConnected);
    
    otherDevices.forEach(dev => {
      const directConnections = connectionMatrix[dev][mostConnected] || 0;
      if (directConnections > 0) {
        directlyConnected.push({ dev: dev, strength: directConnections });
      }
    });
    
    // Sort by connection strength (stronger connections get priority for adjacent positions)
    directlyConnected.sort((a, b) => b.strength - a.strength);
    console.log('Directly connected devices to center:', directlyConnected);
    
    // Place directly connected switches adjacent to center (left and right)
    // This minimizes cable length for direct connections
    let leftPos = middleIndex - 1;
    let rightPos = middleIndex + 1;
    
    directlyConnected.forEach((item, idx) => {
      if (idx === 0 && rightPos < numDevices) {
        // First (strongest) connection goes to the right
        deviceToIndex[item.dev] = rightPos;
        rightPos++;
      } else if (leftPos >= 0) {
        // Second connection goes to the left
        deviceToIndex[item.dev] = leftPos;
        leftPos--;
      } else if (rightPos < numDevices) {
        // Fallback to right if left is full
        deviceToIndex[item.dev] = rightPos;
        rightPos++;
      }
    });
    
    // Place any remaining devices (not directly connected) in remaining positions
    const placedDevices = new Set(Object.keys(deviceToIndex));
    const unplacedDevices = otherDevices.filter(d => !placedDevices.has(d));
    
    unplacedDevices.forEach(dev => {
      if (leftPos >= 0) {
        deviceToIndex[dev] = leftPos;
        leftPos--;
      } else if (rightPos < numDevices) {
        deviceToIndex[dev] = rightPos;
        rightPos++;
      }
    });
    
    console.log('Device position mapping:', deviceToIndex);
    
    // First pass: Calculate maximum switch width needed across all devices
    let maxSwitchWidth = 0;
    DATA.device_nodes.forEach((n) => {
      const dev = n.label;
      const ports = DATA.ports_by_device[dev] || [];
      const numberOfRows = layoutConfig.numberOfRows;
      const portsPerRow = Math.ceil(ports.length / numberOfRows);
      
      // Calculate max ports in any row for this device
      let maxPortsInAnyRow = 0;
      for (let rowIdx = 0; rowIdx < numberOfRows; rowIdx++) {
        const startIdx = rowIdx * portsPerRow;
        const endIdx = Math.min(startIdx + portsPerRow, ports.length);
        const rowPorts = ports.slice(startIdx, endIdx);
        maxPortsInAnyRow = Math.max(maxPortsInAnyRow, rowPorts.length);
      }
      
      const deviceWidth = maxPortsInAnyRow * portSpacing + 100;
      maxSwitchWidth = Math.max(maxSwitchWidth, deviceWidth);
    });
    
    // Set device spacing based on maximum width
    layoutConfig.switchWidth = maxSwitchWidth;
    layoutConfig.deviceSpacing = layoutConfig.switchWidth + 400;
    const deviceSpacing = layoutConfig.deviceSpacing;
    
    // Create device nodes and port nodes with optimized positions
    console.log('Creating physical port view for', DATA.device_nodes.length, 'devices');
    DATA.device_nodes.forEach((n) => {
      const dev = n.label;
      const optimalIndex = deviceToIndex[dev] || 0;
      const ports = DATA.ports_by_device[dev] || [];
      const deviceX = startX + optimalIndex * deviceSpacing;
      console.log(`Device ${dev} at optimal index ${optimalIndex}, X position: ${deviceX}, ports: ${ports.length}, connections: ${deviceConnections[dev]}`);
      
      // Distribute ports evenly across the specified number of rows
      const numberOfRows = layoutConfig.numberOfRows;
      const portsPerRow = Math.ceil(ports.length / numberOfRows);
      const portRows = [];
      
      // Split ports into rows
      for (let rowIdx = 0; rowIdx < numberOfRows; rowIdx++) {
        const startIdx = rowIdx * portsPerRow;
        const endIdx = Math.min(startIdx + portsPerRow, ports.length);
        portRows.push(ports.slice(startIdx, endIdx));
      }
      
      // Create port nodes in each row
      portRows.forEach((rowPorts, rowIdx) => {
        const rowY = layoutConfig.rowYPositions[rowIdx];
        const rowPortWidth = rowPorts.length * portSpacing;
        const portStartX = deviceX - rowPortWidth / 2 + portSpacing / 2;
        
        rowPorts.forEach((port, index) => {
          const meta = DATA.port_meta[`${dev}:${port}`] || {};
          const status = (meta.status || "?").toLowerCase();
          const isUp = status === "up";
          const isConnected = DATA.port_edges.some(e => 
            (e.meta.a_dev === dev && e.meta.a_port === port) ||
            (e.meta.b_dev === dev && e.meta.b_port === port)
          );
          
          // Color based on status and connection
          let portColor = "#cccccc";
          if (isUp && isConnected) portColor = "#90EE90";
          else if (isUp) portColor = "#FFE4B5";
          else if (isConnected) portColor = "#FFB6C1";
          
          // Add VLAN to label in parentheses if available
          let portLabel = port;
          const vlan = meta.vlan;
          if (vlan) {
            portLabel = `${port} (${vlan})`;
          }
          
          const portId = `port:${dev}:${port}`;
          const portX = portStartX + index * portSpacing;
          
          // Build tooltip with VLAN info
          let tooltip = `${port}\n${meta.alias || "???"}\nStatus: ${meta.status || "?"}\nSpeed: ${meta.speed || "N/A"}`;
          if (vlan) {
            tooltip += `\nVLAN: ${vlan}`;
          }
          
          nodes.add({
            id: portId,
            label: portLabel,
            shape: "box",
            x: portX,
            y: rowY,
            fixed: { x: true, y: true },
            size: 20, // Reduced size to ensure spacing works
            font: { size: 7 }, // Smaller font to prevent label overlap
            color: { 
              background: portColor,
              border: isUp ? "#228B22" : "#8B0000",
              highlight: { background: "#FFD700", border: "#FF8C00" }
            },
            title: tooltip
          });
        });
      });
      
      // Create a label node showing device name and port count above the dashed box
      const labelId = `label:${dev}`;
      const firstRowY = layoutConfig.rowYPositions[0] || 250;
      const labelY = firstRowY - 90; // Position well above first row of ports, outside the dashed box
      nodes.add({
        id: labelId,
        label: `${dev} (${ports.length})`,
        shape: "box",
        x: deviceX,
        y: labelY,
        fixed: { x: true, y: true },
        font: { size: 16, bold: true },
        color: { background: "#f0f0f0", border: "#999", highlight: { background: "#e0e0e0" } },
        widthConstraint: { minimum: 140 },
        heightConstraint: { minimum: 35 }
      });
    });

    // Edges will be added after network is initialized (see addEdgesAfterInit function)
  }

  function addDeviceNodes() {
    createPhysicalPortView();
  }

  function addEdgesAfterInit() {
    if (!network || !edges) {
      console.warn('addEdgesAfterInit: network or edges not ready');
      return;
    }
    
    console.log('Adding edges, total port_edges:', (DATA.port_edges || []).length);
    console.log('Total nodes available:', nodes.length);
    
    // Group edges by device pair to offset parallel edges
    const edgesByDevicePair = {};
    let skippedEdges = 0;
    let addedEdges = 0;
    
    (DATA.port_edges || []).forEach((e, idx) => {
      const dev1 = e.meta.a_dev;
      const dev2 = e.meta.b_dev;
      // Create a consistent key for the device pair (alphabetically sorted)
      const pairKey = dev1 < dev2 ? `${dev1}:${dev2}` : `${dev2}:${dev1}`;
      if (!edgesByDevicePair[pairKey]) {
        edgesByDevicePair[pairKey] = [];
      }
      edgesByDevicePair[pairKey].push({ edge: e, index: idx });
    });
    
    // Color palette for different links (helps differentiate)
    const colorPalette = [
      "#0066FF", // Bright blue
      "#0066CC", // Darker blue
      "#0080FF", // Lighter blue
      "#0040FF", // Deep blue
      "#3399FF", // Sky blue
      "#0066AA", // Navy blue
    ];
    
    // Add port-to-port connections without labels, with offset for parallel edges
    Object.keys(edgesByDevicePair).forEach(pairKey => {
      const pairEdges = edgesByDevicePair[pairKey];
      const totalEdges = pairEdges.length;
      
      pairEdges.forEach((item, localIdx) => {
        const e = item.edge;
        const globalIdx = item.index;
        const edgeId = `p2p:${e.from}<->${e.to}`;
        
        // Check if both nodes exist - log if they don't for debugging
        const fromNode = nodes.get(e.from);
        const toNode = nodes.get(e.to);
        
        if (!fromNode || !toNode) {
          skippedEdges++;
          console.warn(`Edge ${edgeId} skipped - nodes not found:`, {
            from: e.from,
            to: e.to,
            fromExists: !!fromNode,
            toExists: !!toNode
          });
          return; // Skip this edge if nodes don't exist
        }
        
        // Extract port names for tooltip
        const fromPort = e.meta.a_port || e.from.split(':').slice(2).join(':');
        const toPort = e.meta.b_port || e.to.split(':').slice(2).join(':');
        
        // Use color variation based on global index
        const colorIndex = globalIdx % colorPalette.length;
        const edgeColor = colorPalette[colorIndex];
        
        // Calculate offset for parallel edges to spread them vertically
        // Use continuous curves with varying roundness to create separation
        const offsetIndex = localIdx - Math.floor(totalEdges / 2); // Center around 0
        const maxOffset = Math.max(1, Math.floor(totalEdges / 2));
        const normalizedOffset = totalEdges > 1 ? offsetIndex / maxOffset : 0;
        
        // Use alternating curve directions to create vertical separation
        let smoothType = "curvedCW";
        let roundness = 0.5;
        
        if (totalEdges > 1) {
          // Alternate between curvedCW and curvedCCW to create natural separation
          // Edges curve in opposite directions, preventing overlap
          if (localIdx % 2 === 0) {
            smoothType = "curvedCW";
          } else {
            smoothType = "curvedCCW";
          }
          // Vary roundness based on position to create a fan effect
          // Edges further from center have more curve
          roundness = 0.3 + (Math.abs(normalizedOffset) * 0.4);
        } else {
          // Single edge - use curved type with good roundness to avoid going through ports
          smoothType = "curvedCW";
          roundness = 0.6; // Higher roundness to ensure it curves around ports
        }
        
        // Add edge - ensure it's always selectable
        try {
          edges.add({
            id: edgeId,
            from: e.from,
            to: e.to,
            label: "", // No label on edge
            width: 4, // Slightly thicker for better visibility
            color: { 
              color: edgeColor, 
              highlight: "#FF0000"
            },
            smooth: { 
              type: smoothType,
              roundness: roundness
            },
            selectable: true, // Make edge clickable
            selectionWidth: 20, // Wide selection area - makes endpoints clickable
            hoverWidth: 15, // Wide hover area for better feedback
            // Store original edge data for display in panel
            title: `${fromPort} ↔ ${toPort}`, // Full label in tooltip
            meta: e.meta // Store metadata for panel display
          });
          addedEdges++;
        } catch (err) {
          console.error(`Failed to add edge ${edgeId}:`, err);
          skippedEdges++;
        }
      });
    });
    
    console.log(`Edge addition complete: ${addedEdges} added, ${skippedEdges} skipped`);

    // Add segment connections
    ensureSegmentNodes();
    const addedSegEdges = new Set(); // Track added edges to avoid duplicates
    (DATA.seg_edges || []).forEach(e => {
      const portId = `port:${e.meta.dev}:${e.meta.port}`;
      // Only show if port node and segment node exist
      if (nodes.get(portId) && nodes.get(e.to)) {
        const edgeId = `seg:${portId}->${e.to}`;
        // Check if edge already exists
        if (!addedSegEdges.has(edgeId) && !edges.get(edgeId)) {
          addedSegEdges.add(edgeId);
          edges.add({
            id: edgeId,
            from: portId,
            to: e.to,
            label: "", // No label on edge - shown in panel when clicked
            dashes: true,
            width: 2,
            color: { color: "#FF6347", highlight: "#FF0000" }, // Red highlight for links
            smooth: { type: "dynamic", roundness: 0.5 }, // Dynamic routing to avoid nodes
            // Store original edge data for display in panel
            title: e.label || "shared", // Tooltip
            meta: e.meta // Store metadata for panel display
          });
        }
      }
    });
  }


  function ensureSegmentNodes() {
    const segNodes = DATA.seg_nodes || [];
    if (segNodes.length === 0) return;
    
    // Calculate Y position below all switches (below last row of ports)
    const lastRowY = layoutConfig.rowYPositions[layoutConfig.rowYPositions.length - 1] || 250;
    const segY = lastRowY + 100; // Position below last row
    
    // Get device position mapping for optimal layout
    const deviceNames = DATA.device_nodes.map(n => n.label);
    const connectionMatrix = {};
    deviceNames.forEach(dev => {
      connectionMatrix[dev] = {};
      deviceNames.forEach(otherDev => {
        if (dev !== otherDev) connectionMatrix[dev][otherDev] = 0;
      });
    });
    (DATA.port_edges || []).forEach(e => {
      const dev1 = e.meta.a_dev;
      const dev2 = e.meta.b_dev;
      if (dev1 !== dev2 && connectionMatrix[dev1] && connectionMatrix[dev1][dev2] !== undefined) {
        connectionMatrix[dev1][dev2]++;
        connectionMatrix[dev2][dev1]++;
      }
    });
    const deviceConnections = {};
    deviceNames.forEach(dev => {
      deviceConnections[dev] = Object.values(connectionMatrix[dev] || {}).reduce((sum, count) => sum + count, 0);
    });
    const sortedDevices = [...deviceNames].sort((a, b) => deviceConnections[b] - deviceConnections[a]);
    const mostConnected = sortedDevices[0];
    const numDevices = sortedDevices.length;
    const middleIndex = Math.floor(numDevices / 2);
    const deviceToIndex = {};
    deviceToIndex[mostConnected] = middleIndex;
    const otherDevices = sortedDevices.filter(d => d !== mostConnected);
    const directlyConnected = [];
    otherDevices.forEach(dev => {
      const directConnections = connectionMatrix[dev][mostConnected] || 0;
      if (directConnections > 0) {
        directlyConnected.push({ dev: dev, strength: directConnections });
      }
    });
    directlyConnected.sort((a, b) => b.strength - a.strength);
    let leftPos = middleIndex - 1;
    let rightPos = middleIndex + 1;
    directlyConnected.forEach((item, idx) => {
      if (idx === 0 && rightPos < numDevices) {
        deviceToIndex[item.dev] = rightPos;
        rightPos++;
      } else if (leftPos >= 0) {
        deviceToIndex[item.dev] = leftPos;
        leftPos--;
      } else if (rightPos < numDevices) {
        deviceToIndex[item.dev] = rightPos;
        rightPos++;
      }
    });
    const placedDevices = new Set(Object.keys(deviceToIndex));
    const unplacedDevices = otherDevices.filter(d => !placedDevices.has(d));
    unplacedDevices.forEach(dev => {
      if (leftPos >= 0) {
        deviceToIndex[dev] = leftPos;
        leftPos--;
      } else if (rightPos < numDevices) {
        deviceToIndex[dev] = rightPos;
        rightPos++;
      }
    });
    
    // Position each SEG node under its corresponding switch
    segNodes.forEach(s => {
      if (nodes.get(s.id)) return;
      
      // Extract device name from SEG label (e.g., "SEG:sonic1:eth0" -> "sonic1")
      const segLabel = s.label || s.id;
      const match = segLabel.match(/SEG:([^:]+):/);
      const targetDevice = match ? match[1] : null;
      
      let segX;
      if (targetDevice && deviceToIndex[targetDevice] !== undefined) {
        // Position under the corresponding switch
        const deviceIndex = deviceToIndex[targetDevice];
        segX = layoutConfig.startX + deviceIndex * layoutConfig.deviceSpacing;
      } else {
        // Fallback: distribute evenly if device name can't be extracted
        const index = segNodes.indexOf(s);
        const numSegNodes = segNodes.length;
        const totalWidth = (DATA.device_nodes.length - 1) * layoutConfig.deviceSpacing + layoutConfig.switchWidth;
        const segSpacing = totalWidth / (numSegNodes + 1);
        const segStartX = layoutConfig.startX - layoutConfig.switchWidth / 2;
        segX = segStartX + (index + 1) * segSpacing;
      }
      
      nodes.add({
        id: s.id,
        label: s.label,
        shape: "diamond",
        x: segX,
        y: segY,
        fixed: { x: true, y: true },
        font: { size: 11 },
        margin: 8,
        color: { background: "#e0e0e0", border: "#666" }
      });
    });
  }


  function setMode(newMode) {
    mode = newMode;
    // Always show physical port view now
    createPhysicalPortView();
    network.fit({ animation: true });
  }

  // Function to update number of rows and re-render (must be global for inline handler)
  window.updateNumberOfRows = function(value) {
    const numValue = parseInt(value, 10);
    layoutConfig.numberOfRows = numValue;
    
    // Recalculate row Y positions
    const numberOfRows = layoutConfig.numberOfRows;
    const firstRowY = 250;
    layoutConfig.rowYPositions = [];
    for (let i = 0; i < numberOfRows; i++) {
      layoutConfig.rowYPositions.push(firstRowY + i * layoutConfig.rowHeight);
    }
    
    // Reset switch width calculation
    layoutConfig.switchWidth = 0;
    layoutConfig.deviceSpacing = 0;
    
    // Update the display value
    document.getElementById("numberOfRowsValue").textContent = numValue;
    
    // Re-render the topology
    if (network && nodes && edges) {
      // Clear existing edges before re-rendering
      edges.clear();
      createPhysicalPortView();
      // Re-add edges after nodes are positioned - ensure nodes are ready
      setTimeout(function() {
        addEdgesAfterInit();
        network.fit({ animation: true });
      }, 300);
    }
  };

  function showWarnings() {
    // Warnings/Notes section removed per user request
    const w = document.getElementById("warnings");
    if (w) {
      w.innerHTML = "";
    }
  }

  function showSelection(text) {
    document.getElementById("selection").innerHTML = text;
  }

  function showPortsForDevice(dev) {
    const ports = DATA.ports_by_device[dev] || [];
    if (ports.length === 0) {
      document.getElementById("portList").innerHTML = "<span class='muted'>No linked ports for this device.</span>";
      return;
    }
    const pills = ports.map(p => {
      const meta = DATA.port_meta[`${dev}:${p}`] || {};
      const s = meta.status || "?";
      return `<span class="pill">${p} | ${meta.alias || "???" } | ${s}</span>`;
    }).join(" ");
    document.getElementById("portList").innerHTML = pills;
  }

  try {
    network = new vis.Network(
      networkContainer,
      { nodes, edges },
      {
        layout: {
          hierarchical: {
            enabled: false
          }
        },
        physics: {
          enabled: true,  // Enable physics for edge routing to avoid nodes
          stabilization: { 
            enabled: true,
            iterations: 50,  // Quick stabilization
            fit: false  // Don't auto-fit after stabilization
          },
          barnesHut: {
            gravitationalConstant: -100,  // Very weak forces
            centralGravity: 0.01,
            springLength: 300,
            springConstant: 0.001,  // Very weak spring
            damping: 0.5  // High damping to keep nodes stable
          }
        },
        groups: {
          // Define device group styling
          'dev:sonic1': { color: { background: '#e8e8e8', border: '#666' } },
          'dev:sonic2': { color: { background: '#e8e8e8', border: '#666' } },
          'dev:sonic3': { color: { background: '#e8e8e8', border: '#666' } }
        },
        interaction: { 
          hover: true, 
          multiselect: true,
          tooltipDelay: 100,
          selectConnectedEdges: false, // Don't auto-select connected edges
          selectable: true, // Allow selection of nodes and edges
          hoverConnectedEdges: false, // Don't auto-hover connected edges
          // Make edges easier to click, especially at endpoints
          dragNodes: true,
          dragView: true,
          zoomView: true
        },
        edges: { 
          font: { align: "middle", size: 11, strokeWidth: 3, strokeColor: "#ffffff" },
          arrows: { to: { enabled: false } },
          smooth: { type: "dynamic", roundness: 0.8 }, // Dynamic routing to avoid nodes and spread links
          labelHighlightBold: true, // Make labels bold on hover for better visibility
          chosen: true, // Use default highlighting - more reliable than custom function
          selectionWidth: 20, // Very wide selection area - makes entire edge clickable including endpoints
          hoverWidth: 15, // Wider hover area for better feedback
          width: 4 // Default width
        },
        nodes: {
          borderWidth: 2,
          shadow: true,
          // Don't block edge clicks at endpoints
          fixed: false // Allow nodes to not block edge selection
        }
      }
    );
    console.log('Network created successfully');
    
    // Add edges after network is initialized to ensure proper label positioning
    // Use a longer delay and retry mechanism to ensure all nodes are ready
    let retryCount = 0;
    const maxRetries = 5;
    
    function tryAddEdges() {
      // Check if we have the expected number of nodes
      const expectedPortCount = Object.values(DATA.ports_by_device || {}).reduce((sum, ports) => sum + ports.length, 0);
      const actualNodeCount = nodes.length;
      
      if (actualNodeCount < expectedPortCount && retryCount < maxRetries) {
        retryCount++;
        console.log(`Waiting for nodes to be ready (attempt ${retryCount}/${maxRetries})...`);
        setTimeout(tryAddEdges, 200);
        return;
      }
      
      addEdgesAfterInit();
      network.redraw();
      
      // Lock all nodes after positioning to prevent movement while allowing edge routing
      setTimeout(function() {
        const allNodeIds = nodes.getIds();
        const positions = network.getPositions(allNodeIds);
        allNodeIds.forEach(nodeId => {
          const pos = positions[nodeId];
          if (pos) {
            nodes.update({
              id: nodeId,
              fixed: { x: true, y: true } // Lock node position
            });
          }
        });
        // Disable physics after locking nodes
        physicsEnabled = false;
        network.setOptions({
          physics: { enabled: false }
        });
        network.redraw();
      }, 1000); // Wait for physics to settle
    }
    
    setTimeout(tryAddEdges, 300);
    
    // Draw boxes around port groups using canvas drawing
    network.on("afterDrawing", function(ctx) {
      if (!network) return;
      
      // Draw boxes around each device's port group
      // Need to recalculate device positions based on optimal layout
      const deviceNames = DATA.device_nodes.map(n => n.label);
      const connectionMatrix = {};
      deviceNames.forEach(dev => {
        connectionMatrix[dev] = {};
        deviceNames.forEach(otherDev => {
          if (dev !== otherDev) connectionMatrix[dev][otherDev] = 0;
        });
      });
      (DATA.port_edges || []).forEach(e => {
        const dev1 = e.meta.a_dev;
        const dev2 = e.meta.b_dev;
        if (dev1 !== dev2 && connectionMatrix[dev1] && connectionMatrix[dev1][dev2] !== undefined) {
          connectionMatrix[dev1][dev2]++;
          connectionMatrix[dev2][dev1]++;
        }
      });
      const deviceConnections = {};
      deviceNames.forEach(dev => {
        deviceConnections[dev] = Object.values(connectionMatrix[dev] || {}).reduce((sum, count) => sum + count, 0);
      });
      const sortedDevices = [...deviceNames].sort((a, b) => deviceConnections[b] - deviceConnections[a]);
      const deviceToIndex = {};
      sortedDevices.forEach((dev, idx) => { deviceToIndex[dev] = idx; });
      
      DATA.device_nodes.forEach((n) => {
        const dev = n.label;
        const deviceIndex = deviceToIndex[dev] || 0;
        const ports = DATA.ports_by_device[dev] || [];
        const portIds = ports.map(p => `port:${dev}:${p}`);
        const labelId = `label:${dev}`;
        
        // Get positions of all ports (label is outside the box, so exclude it)
        const allNodeIds = [...portIds]; // Exclude labelId - label is above the box
        const positions = network.getPositions(allNodeIds);
        
        if (positions && Object.keys(positions).length > 0) {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          
          // Calculate bounding box for ports only (label is above the box)
          allNodeIds.forEach(nodeId => {
            const pos = positions[nodeId];
            if (pos) {
              // Estimate node sizes
              let nodeSize = 30;
              if (nodeId.startsWith('port:')) nodeSize = 25;
              
              minX = Math.min(minX, pos.x - nodeSize/2);
              minY = Math.min(minY, pos.y - nodeSize/2);
              maxX = Math.max(maxX, pos.x + nodeSize/2);
              maxY = Math.max(maxY, pos.y + nodeSize/2);
            }
          });
          
          if (minX !== Infinity) {
            const padding = 30;
            
            // Ensure box doesn't extend beyond this switch's allocated area
            const switchCenterX = layoutConfig.startX + deviceIndex * layoutConfig.deviceSpacing;
            const maxAllowedWidth = layoutConfig.switchWidth;
            const actualWidth = maxX - minX + 2 * padding;
            
            // Center the box around the switch center if needed
            if (actualWidth < maxAllowedWidth) {
              const centerX = (minX + maxX) / 2;
              const offset = switchCenterX - centerX;
              minX += offset;
              maxX += offset;
            }
            
            ctx.save();
            
            // Draw device box (coordinates are already in canvas space in afterDrawing)
            ctx.strokeStyle = '#666666';
            ctx.lineWidth = 3;
            ctx.setLineDash([12, 6]);
            ctx.globalAlpha = 0.8;
            ctx.strokeRect(
              minX - padding,
              minY - padding,
              maxX - minX + 2 * padding,
              maxY - minY + 2 * padding
            );
            ctx.restore();
          }
        }
      });
    });
    
    // Redraw boxes when view changes
    network.on("zoom", function() {
      network.redraw();
    });
    
    network.on("dragEnd", function() {
      network.redraw();
    });
    

  } catch (error) {
    console.error('Error creating network:', error);
    networkContainer.innerHTML = '<div style="padding: 20px; color: red;">Error creating network: ' + error.message + '</div>';
    return;
  }

  // Note: Hover highlighting is handled by vis-network's built-in hover functionality
  // configured in the edges.chosen option above. The click handlers below provide
  // additional highlighting for better visibility.

  network.on("click", function(params) {
  // Clear previous selections (safely)
  try {
    network.setSelection({ nodes: [], edges: [] });
  } catch (err) {
    console.error('Error clearing selection:', err);
  }
  
  if (params.nodes.length === 1) {
    const nodeId = params.nodes[0];
    
    // Highlight the selected node
    network.setSelection({ nodes: [nodeId], edges: [] });

    if (nodeId.startsWith("label:")) {
      const dev = nodeId.replace("label:", "");
      const ports = DATA.ports_by_device[dev] || [];
      const connectedPorts = ports.filter(p => {
        return DATA.port_edges.some(e => 
          (e.meta.a_dev === dev && e.meta.a_port === p) ||
          (e.meta.b_dev === dev && e.meta.b_port === p)
        );
      });
      showPortsForDevice(dev);
      showSelection(`<b>Switch:</b> ${dev}<br/><span class="muted">Total ports: ${ports.length}<br/>Connected ports: ${connectedPorts.length}</span>`);
      return;
    }

    if (nodeId.startsWith("port:")) {
      const parts = nodeId.split(":");
      const dev = parts[1];
      const port = parts.slice(2).join(":");
      const meta = DATA.port_meta[`${dev}:${port}`] || {};
      
      // Find all edges connected to this port
      const connectedEdges = edges.get({
        filter: function(edge) {
          return edge.from === nodeId || edge.to === nodeId;
        }
      });
      const edgeIds = connectedEdges.map(e => e.id);
      
      // Find all ports on the other end of connected edges
      const connectedPortIds = new Set();
      connectedEdges.forEach(e => {
        if (e.from === nodeId) {
          connectedPortIds.add(e.to);
        } else if (e.to === nodeId) {
          connectedPortIds.add(e.from);
        }
      });
      
      // Highlight: the port, all its connected edges, and ports on the other end
      const nodesToHighlight = [nodeId, ...Array.from(connectedPortIds)];
      network.setSelection({ nodes: nodesToHighlight, edges: edgeIds });
      
      // Show port info and connection details
      let portInfo = `<b>Port:</b> ${dev}:${port}<br/><pre>${JSON.stringify(meta, null, 2)}</pre>`;
      if (connectedEdges.length > 0) {
        portInfo += `<br/><b>Connections (${connectedEdges.length}):</b><br/>`;
        connectedEdges.forEach(e => {
          const fromPort = e.meta?.a_port || e.from.split(':').slice(2).join(':');
          const toPort = e.meta?.b_port || e.to.split(':').slice(2).join(':');
          portInfo += `<span class="muted">• ${fromPort} ↔ ${toPort}</span><br/>`;
        });
      }
      showSelection(portInfo);
      return;
    }

    if (nodeId.startsWith("seg:")) {
      showSelection(`<b>Segment:</b> ${nodeId.slice(4)}<br/><span class="muted">Shared L2 segment / flooded LLDP domain.</span>`);
      return;
    }
  }

  if (params.edges.length > 0) {
    // Handle edge clicks - use first edge if multiple are clicked
    const edgeId = params.edges[0];
    const e = edges.get(edgeId);
    
    if (!e) {
      console.error('Edge not found:', edgeId, 'Available edges:', edges.getIds().length);
      return;
    }
    
    // Highlight the edge and both connected ports
    const connectedPorts = [e.from, e.to];
    try {
      network.setSelection({ nodes: connectedPorts, edges: [edgeId] });
    } catch (err) {
      console.error('Error setting selection:', err);
    }
    
    // Find the original edge data to get the label
    let edgeLabel = "";
    let edgeMeta = null;
    
    if (edgeId.startsWith('p2p:')) {
      // Port-to-port edge - try to find by ID first, then by from/to
      const originalEdge = (DATA.port_edges || []).find(pe => {
        const peId = `p2p:${pe.from}<->${pe.to}`;
        return peId === edgeId || (pe.from === e.from && pe.to === e.to);
      });
      if (originalEdge) {
        edgeLabel = originalEdge.label;
        edgeMeta = originalEdge.meta;
      } else {
        // Fallback: use edge metadata if available
        if (e.meta) {
          edgeMeta = e.meta;
          const fromPort = e.meta.a_port || e.from.split(':').slice(2).join(':');
          const toPort = e.meta.b_port || e.to.split(':').slice(2).join(':');
          edgeLabel = `${fromPort} ↔ ${toPort}`;
        }
      }
    } else if (edgeId.startsWith('seg:')) {
      // Segment edge - format is seg:port:dev:port->seg:SEG:dev:port
      const originalEdge = (DATA.seg_edges || []).find(se => {
        const portId = `port:${se.meta.dev}:${se.meta.port}`;
        const expectedEdgeId = `seg:${portId}->${se.to}`;
        return expectedEdgeId === edgeId;
      });
      if (originalEdge) {
        edgeLabel = originalEdge.label || "--shared--";
        edgeMeta = originalEdge.meta;
      }
    }
    
    // Display edge information in panel
    let edgeInfo = `<b>Connection:</b><br/>`;
    if (edgeLabel) {
      edgeInfo += `<b>${edgeLabel}</b><br/><br/>`;
    }
    if (edgeMeta) {
      if (edgeMeta.a_dev && edgeMeta.a_port) {
        edgeInfo += `<b>From:</b> ${edgeMeta.a_dev}:${edgeMeta.a_port}<br/>`;
      }
      if (edgeMeta.b_dev && edgeMeta.b_port) {
        edgeInfo += `<b>To:</b> ${edgeMeta.b_dev}:${edgeMeta.b_port}<br/>`;
      }
      if (edgeMeta.dev && edgeMeta.port && edgeMeta.seg) {
        edgeInfo += `<b>Device:</b> ${edgeMeta.dev}:${edgeMeta.port}<br/>`;
        edgeInfo += `<b>Segment:</b> ${edgeMeta.seg}<br/>`;
      }
    } else {
      edgeInfo += `<pre>${JSON.stringify(e, null, 2)}</pre>`;
    }
    
    showSelection(edgeInfo);
    return;
  }

    showSelection("Nothing selected.");
  });

  showWarnings();
  
  // Initialize the number of rows slider
  const slider = document.getElementById("numberOfRowsSlider");
  if (slider) {
    slider.value = layoutConfig.numberOfRows;
    document.getElementById("numberOfRowsValue").textContent = layoutConfig.numberOfRows;
  }
  
  createPhysicalPortView();
  
  console.log('Nodes:', nodes.length, 'Edges:', edges.length);
  console.log('Device nodes:', DATA.device_nodes.length);
  
  // Wait a bit for network to be ready, then manually set view to show all switches
  setTimeout(function() {
    try {
      // Get all node positions to calculate bounding box
      const allNodeIds = nodes.getIds();
      console.log('Total nodes to position:', allNodeIds.length);
      
      // Wait a bit more for positions to be available
      setTimeout(function() {
        const positions = network.getPositions(allNodeIds);
        console.log('Got positions for', Object.keys(positions).length, 'nodes');
        
        if (positions && Object.keys(positions).length > 0) {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          
          Object.keys(positions).forEach(nodeId => {
            const pos = positions[nodeId];
            if (pos) {
              minX = Math.min(minX, pos.x);
              minY = Math.min(minY, pos.y);
              maxX = Math.max(maxX, pos.x);
              maxY = Math.max(maxY, pos.y);
            }
          });
          
          console.log('Bounding box:', { minX, minY, maxX, maxY });
          console.log('Total width:', maxX - minX, 'Total height:', maxY - minY);
          
          if (minX !== Infinity) {
            // Calculate center and scale
            const centerX = (minX + maxX) / 2;
            const centerY = (minY + maxY) / 2;
            const width = maxX - minX;
            const height = maxY - minY;
            
            // Get container dimensions
            const container = networkContainer;
            const containerWidth = container.offsetWidth;
            const containerHeight = container.offsetHeight;
            
            // Calculate scale to fit with padding
            const padding = 100;
            const scaleX = (containerWidth - 2 * padding) / width;
            const scaleY = (containerHeight - 2 * padding) / height;
            const scale = Math.min(scaleX, scaleY, 1.0); // Don't zoom in, only out
            
            console.log('Setting view - center:', centerX, centerY, 'scale:', scale);
            
            // Set the view
            network.moveTo({
              position: { x: centerX, y: centerY },
              scale: scale,
              animation: { duration: 500, easingFunction: 'easeInOutQuad' }
            });
            
            console.log('View set - all switches should be visible');
          }
        } else {
          console.warn('No positions available, trying simple fit');
          network.fit({ animation: true, padding: 100 });
        }
      }, 100);
    } catch (error) {
      console.error('Error setting view:', error);
      // Fallback: try simple fit
      try {
        network.fit({ animation: true, padding: 100 });
      } catch (e) {
        console.error('Fallback fit also failed:', e);
      }
    }
  }, 300);
}

// Initialize when everything is ready
let initialized = false;

function tryInit() {
  // Prevent multiple initializations
  if (initialized) {
    console.log('Already initialized, skipping');
    return true;
  }
  
  console.log('tryInit: checking vis library and DOM...');
  console.log('vis defined:', typeof vis !== 'undefined');
  console.log('network element:', !!document.getElementById('network'));
  
  // Check if both vis library and DOM are ready
  if (typeof vis !== 'undefined' && document.getElementById('network')) {
    console.log('Conditions met, initializing...');
    initialized = true;
    initTopology();
    return true;
  }
  return false;
}

// Multiple strategies to ensure initialization
// Strategy 1: Try immediately (script might load synchronously)
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  if (!tryInit()) {
    // If DOM is ready but vis isn't, wait a bit
    setTimeout(tryInit, 100);
  }
}

// Strategy 2: Wait for DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() {
    setTimeout(tryInit, 50);
  });
}

// Strategy 3: Wait for window load (all resources including scripts)
window.addEventListener('load', function() {
  setTimeout(function() {
    if (!tryInit()) {
      // Still not ready, show error
      setTimeout(function() {
        if (!initialized) {
          const networkDiv = document.getElementById('network');
          if (networkDiv && typeof vis === 'undefined') {
            networkDiv.innerHTML = '<div style="padding: 20px; color: red;">Error: vis-network library failed to load. Please check your internet connection and try refreshing the page.</div>';
          } else if (networkDiv) {
            networkDiv.innerHTML = '<div style="padding: 20px; color: red;">Error: Failed to initialize network visualization. Check browser console for details.</div>';
          }
        }
      }, 500);
    }
  }, 100);
});
