"""2.5D extrusion engine for quadrilateral process meshes.

This module assigns materials to a 2D quadrilateral mesh and extrudes the
selected elements along the z axis into 8-node hexahedral elements.

Design notes:
    * A face is selected only when all four element corners are inside the
      requested shape. Partial overlap is intentionally ignored.
    * Build-time arrays grow by capacity instead of appending one row at a
      time. Use ``element_num`` and ``node_num`` to read the valid slices.
"""

import numpy as np
import json

ELEMENT_2D_LEN = 4
NODE_2D_LEN = 2

ELEMENT_LEN = 8
NODE_LEN = 3

class Dragger:
    """Build a 3D hexahedral mesh from a 2D quadrilateral process layout.

    The workflow is:
        1. Load a 2D quad mesh with :meth:`set_2D`.
        2. For each process layer, label 2D elements with :meth:`_organize`.
        3. Extrude the labeled elements along z with :meth:`_drag`.

    Attributes:
        comps (dict[str, int]): Material/component name to numeric component id.
        elements (numpy.ndarray): 3D element connectivity. Valid rows are
            ``elements[:element_num]`` and each row contains 8 node indices.
        element_ids (numpy.ndarray): External ids for valid 3D elements.
        element_comps (numpy.ndarray): Component ids for valid 3D elements.
        nodes (numpy.ndarray): 3D node coordinates. Valid rows are
            ``nodes[:node_num]`` and each row is ``[x, y, z]``.
        node_ids (numpy.ndarray): External ids for valid 3D nodes.
        element_2D (numpy.ndarray): Source 2D quad connectivity.
        element_2D_volumn (numpy.ndarray): XY area for each 2D element. The
            legacy field name is kept as ``volumn`` for compatibility.
        element_2D_comp (numpy.ndarray): Temporary per-layer component id for
            each 2D element. ``0`` means ``EMPTY`` and is not extruded.
        node_2D (numpy.ndarray): Source 2D node coordinates as ``[x, y]``.
        node_2D_to_3D (numpy.ndarray): Mapping from 2D node id to the current
            top-layer 3D node id. ``-1`` means the node is not active.
    """

    def __init__(self):
        """Initialize empty 2D state, 3D output buffers, and component table."""
        ### component
        self.comps = {"EMPTY":0}
        
        ### 3D elements
        self.element_num = 0
        self.elements = np.empty((0, ELEMENT_LEN), dtype=np.int32)
        self.element_ids = np.empty((0), dtype=np.int32)
        self.element_comps = np.empty((0), dtype=np.int32)
        
        ### nodes
        self.node_num = 0
        self.nodes = np.empty((0, NODE_LEN), dtype=np.float64)
        self.node_ids = np.empty((0), dtype=np.float64)
        
        ### process
        self.element_2D = np.zeros((0, 4), dtype=np.int32)
        self.element_2D_volumn = np.empty((0), dtype=np.float64)
        self.element_2D_comp = np.empty((0), dtype=np.int32)
        self.element_2D_priority = np.empty((0), dtype=np.int32)
        
        self.node_2D = np.empty((0, 2), dtype=np.float64)
        self.node_2D_to_3D = np.zeros((0), dtype=np.int32)
        
    ### initial
    def set_2D(self, nodes, elements):
        nodes = np.asarray(nodes, dtype=np.float64)
        elements = np.asarray(elements, dtype=np.int32)
        if nodes.ndim != 2 or nodes.shape[1] < 2:
            raise ValueError("mesh2D.nodes must have shape (n, 2+)") 
        if elements.ndim != 2 or elements.shape[1] != 4:
            raise ValueError("mesh2D.elements must have shape (m, 4)")
        
        self.element_2D = elements
        self.element_2D_comp = np.zeros(len(elements), dtype=np.int32)
        self.element_2D_volumn = np.empty(len(elements), dtype=np.float64)
        self.element_2D_priority = np.zeros(len(elements), dtype=np.int32)
        self.node_2D = nodes[:,:2]
        self.node_2D_to_3D = np.zeros(len(nodes), dtype=np.int32) - 1
        
        self._cal_volumns()
        
    ### buffer growth
    def _pre_allocate_nodes(self, size: int = 1):
        """Ensure the internal 3D node buffer can hold additional rows.

        Args:
            size (int): Number of new node rows that will be appended.

        Notes:
            This method only grows capacity. ``node_num`` still controls how
            many rows are valid.
        """
        required = self.node_num + size
        current_capacity = len(self.nodes)
        if required > current_capacity:
            new_capacity = max(required, int(current_capacity * 1.5))
            extra = new_capacity - current_capacity
            
            self.nodes = np.vstack([self.nodes, np.empty((extra, 3), dtype=np.float64)])
            self.node_ids = np.concatenate([self.node_ids, np.empty(extra, dtype=np.int32)])

    def _pre_allocate_elements(self, size: int = 1):
        """Ensure the internal 3D element buffers can hold additional rows.

        Args:
            size (int): Number of new element rows that will be appended.

        Notes:
            This method grows connectivity, id, and component arrays together.
            ``element_num`` still controls how many rows are valid.
        """
        required = self.element_num + size
        current_capacity = len(self.elements)
        if required > current_capacity:
            new_capacity = max(required, int(current_capacity * 1.5))
            extra = new_capacity - current_capacity
            
            self.elements = np.vstack([self.elements, np.empty((extra, 8), dtype=np.int32)])
            self.element_ids = np.concatenate([self.element_ids, np.empty(extra, dtype=np.int32)])
            self.element_comps = np.concatenate([self.element_comps, np.empty(extra, dtype=np.int32)])
        
    ### core
    def _cal_volumns(self):
        """Calculate XY area for every source 2D quadrilateral element.

        Returns:
            None: Results are written to ``self.element_2D_volumn``.

        Notes:
            The legacy field name ``volumn`` is preserved in the public state,
            but the value is the 2D face area used for density calculations.
        """
        corner_xy = self.node_2D[self.element_2D]

        # Extract coordinates as (N, 4) for each x and y
        x1, y1 = corner_xy[:, 0, 0], corner_xy[:, 0, 1]
        x2, y2 = corner_xy[:, 1, 0], corner_xy[:, 1, 1]
        x3, y3 = corner_xy[:, 2, 0], corner_xy[:, 2, 1]
        x4, y4 = corner_xy[:, 3, 0], corner_xy[:, 3, 1]

        # Shoelace formula for quadrilateral
        voulmn = 0.5 * np.abs(
            x1*y2 + x2*y3 + x3*y4 + x4*y1 -
            (y1*x2 + y2*x3 + y3*x4 + y4*x1)
        )

        self.element_2D_volumn = voulmn.astype(np.float64, copy=False)
        
    def _normalize_element_indices(self, indices=None):
        """Normalize optional element indices into a 1D int32 array.

        Args:
            element_indices (int | Sequence[int] | numpy.ndarray | None):
                Optional 2D element indices. ``None`` means all 2D elements.

        Returns:
            numpy.ndarray: 1D array of 2D element indices.
        """
        if indices is None:
            return np.arange(len(self.element_2D), dtype=np.int32)

        indices = np.asarray(indices, dtype=np.int32)
        if indices.ndim == 0:
            indices = indices.reshape(1)
        return indices

    def _element_coordinates(self, indices=None):
        indices = self._normalize_element_indices(indices)
        if len(indices) == 0:
            return np.empty((0, ELEMENT_2D_LEN, NODE_2D_LEN), dtype=self.node_2D.dtype)

        corner_xy = self.node_2D[self.element_2D[indices]]
        return corner_xy
    
    def _search_faces(self, face, indices=None):
        indices = self._normalize_element_indices(indices)
        if 0 == len(indices):
            return np.zeros(0, dtype=np.int32)
        element_coordinates = self._element_coordinates(indices)
        
        face_type = face["type"]
        face_dim = face["dim"]
        
        if face_type == "BOX":
            mask_bl_x = (face_dim[0] < element_coordinates[:,:,0])
            mask_bl_y = (face_dim[1] < element_coordinates[:,:,1])
            mask_tr_x = (element_coordinates[:,:,0] < face_dim[2])
            mask_tr_y = (element_coordinates[:,:,1] < face_dim[3])
            mask = np.all(mask_bl_x & mask_bl_y & mask_tr_x & mask_tr_y, axis=1)
            return mask
        
    def _organize_empty(self):
        """Reset temporary 2D component labels before processing one object."""
        self.element_2D_comp[:] = 0
        self.node_2D_to_3D[:] = -1
        
    def _organize(self, assignments, layer=1):
        for assignment in assignments:
            face = assignment["face"]
            areas = assignment["areas"]
            assign_type = assignment["type"]
            
            ### Select the area once (mask -> indices)
            mask  = self._search_faces(face)
            area_indices = np.where(mask)[0]
            
            if len(area_indices) == 0:
                continue

            if assign_type == 0:
                priority_now = areas[0]["priority"]
                for area in areas[1:]:
                    material = area["material"]
                    priority = area["priority"]
                    
                    ### fill the lower priority
                    mask1 = (self.element_2D_priority[area_indices] <= priority)
                    mask2 = (self.element_2D_priority[area_indices] == priority_now)
                    sub_indices = area_indices[mask1 | mask2]
                    
                    ### local area
                    mask  = self._search_faces(face, indices=sub_indices)
                    sub_indices = sub_indices[mask]
                        
                    ### get (new) material
                    if material not in self.comps:
                        self.comps[material] = len(self.comps)
                    comp_id = self.comps[material]
                    
                    ### assignment
                    self.element_2D_comp[sub_indices] = comp_id
                    self.element_2D_priority[sub_indices] = priority
            else:
                area = areas[0]
                material = area["material"]
                priority = area["priority"]
                
                ### fill the lower priority
                mask = (self.element_2D_priority[area_indices] <= priority)
                sub_indices = area_indices[mask]
                    
                ### get (new) material
                if material not in self.comps:
                    self.comps[material] = len(self.comps)
                comp_id = self.comps[material]
                
                ### assignment
                self.element_2D_comp[sub_indices] = comp_id
                self.element_2D_priority[sub_indices] = priority    
        
    def _drag(self, element_size: float, begin: float, end: float):
        """Extrude currently labeled 2D elements between two z positions.

        Args:
            element_size (float): Requested z element height. The actual height
                is recalculated so an integer number of layers exactly spans
                ``begin`` to ``end``.
            begin (float): Lower z coordinate of the extrusion interval.
            end (float): Upper z coordinate of the extrusion interval.

        Returns:
            int | None: ``0`` when there is no positive distance or no active
            2D element. Otherwise returns ``None`` after appending nodes and
            elements to the internal buffers.

        Notes:
            ``node_2D_to_3D`` stores the top 3D node for each active 2D node.
            That map lets the next process layer reuse the current top surface
            as its bottom surface, keeping adjacent extrusions connected.
        """
        ### calculate drag_num & element_size
        distance  = round(float(end) - float(begin), 5)
        if distance <= 0:
            return 0
        drag_num = int(max(1, np.floor(distance / element_size)))
        element_size = distance / drag_num

        ### target element index
        elem2D_idx = np.flatnonzero(self.element_2D_comp != 0)
        if elem2D_idx.size == 0:
            self.node_2D_to_3D[:] = -1
            return 0

        # unique 2D node ids used by those elements
        elem2D_nodes = self.element_2D[elem2D_idx]
        node2D_idx, inv = np.unique(elem2D_nodes, return_inverse=True)
        elem2D_nodes_local = inv.reshape(elem2D_nodes.shape)   

        ### add the unexisted node
        unexisted_node2D_idx = node2D_idx[self.node_2D_to_3D[node2D_idx] == -1]
        if unexisted_node2D_idx.size:
            self._pre_allocate_nodes(unexisted_node2D_idx.size)
            
            dst = self.nodes[self.node_num : self.node_num + unexisted_node2D_idx.size]
            np.take(self.node_2D, unexisted_node2D_idx, axis=0, out=dst[:, :2]) # xy from 2D nodes -> write directly without temp:
            dst[:, 2] = begin
            
            self.node_2D_to_3D[unexisted_node2D_idx] = np.arange(self.node_num, self.node_num + unexisted_node2D_idx.size, dtype=np.int32)
            self.node_num += unexisted_node2D_idx.size

        ### begin to drag
        base_map = self.node_2D_to_3D[node2D_idx]
        N = node2D_idx.size
        E = elem2D_idx.size

        ### [NODE] allocate all 3D nodes
        self._pre_allocate_nodes(N * drag_num)
        node_start = self.node_num
        new_node_ids = (node_start + np.arange(N * drag_num, dtype=np.int32)).reshape(drag_num, N)

        # fill XY for all layers (broadcast XY), and Z per layer
        xy = self.node_2D[node2D_idx]
        dst_nodes = self.nodes[node_start : node_start + N * drag_num]
        dst_nodes[:, :2] = np.broadcast_to(xy, (drag_num, N, 2)).reshape(N * drag_num, 2)

        z_vals = begin + element_size * (np.arange(1, drag_num + 1, dtype=dst_nodes.dtype))
        dst_nodes[:, 2] = np.repeat(z_vals, N)

        self.node_num += N * drag_num

        ### [ELEMENT] allocate all 3D elements
        self._pre_allocate_elements(E * drag_num)
        elem_start = self.element_num

        # layer->3D index table (drag_num+1, N): row0 = base, rows1..drag_num = new layers
        layer_nodes = np.empty((drag_num + 1, N), dtype=np.int32)
        layer_nodes[0]  = base_map
        layer_nodes[1:] = new_node_ids

        # For each layer k, bottom = layer_nodes[k-1][cols], top = layer_nodes[k][cols]
        # cols per element are the (E,4) indices into node2D_idx
        bottom = layer_nodes[:-1][:, elem2D_nodes_local]
        top    = layer_nodes[1:][:,  elem2D_nodes_local]
        elems  = np.concatenate([bottom, top], axis=2).reshape(drag_num * E, 8)

        ### assign nodes to each element
        self.elements[elem_start : elem_start + drag_num * E] = elems.astype(np.int32, copy=False)
        
        ### assign ids to each element
        last_id = int(np.max(self.element_ids[:self.element_num])) if self.element_num else 0
        self.element_ids[elem_start : elem_start + drag_num * E] = 1 + last_id + np.arange(drag_num * E)

        ### assign comps to each element
        layer_comps = self.element_2D_comp[elem2D_idx]
        dest = self.element_comps[elem_start : elem_start + drag_num * E].reshape(drag_num, E)
        dest[:] = layer_comps
        
        self.element_num += drag_num * E

        # update map so future ops start from the top layer
        self.node_2D_to_3D[:] = -1
        self.node_2D_to_3D[node2D_idx] = layer_nodes[-1]
        
    def build(self, layer_infos, element_size):
        """Build 3D mesh data from process object definitions.

        Args:
            object_list (Sequence[Sequence[dict]]): Process objects. Each
                object is an ordered list of z-level dictionaries. Every entry
                except the last must include ``areas`` and ``element_size``;
                every entry used as a boundary must include ``z``.

        Notes:
            The method appends to existing 3D buffers. It resets temporary 2D
            labels for each object, but it does not clear previously generated
            3D nodes or elements.
        """

        self._organize_empty()
        for index, layer_info in enumerate(layer_infos[:-1]):
            z_now = layer_infos[index]["z"]
            z_next = layer_infos[index+1]["z"]
            assignments = layer_info["assignments"]
            
            self._organize(assignments, index)
            
            self._drag(element_size, z_now, z_next)
            

        self.elements = self.elements[:self.element_num]
        self.element_ids = self.element_ids[:self.element_num]
        self.element_comps = self.element_comps[:self.element_num]
        self.nodes = self.nodes[:self.node_num]
        self.node_ids = self.node_ids[:self.node_num]
        
        print(f"element_num: {self.element_num}")
        print(f"node_num: {self.node_num}")
        print(json.dumps(self.comps, indent=4))