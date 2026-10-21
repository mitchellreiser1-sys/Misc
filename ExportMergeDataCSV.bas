Option Explicit

' ============================================================
'  ExportMergeDataCSV  —  v6 (10/21/2026)
'  Exports LONG-format CSV: one row per field (field_name,value).
'   - Field list  = '_Merge Architecture'!G2:last  (single source of truth)
'   - Values      = 'Merge Data' row 2, exported AS DISPLAYED (cell .Text),
'                   so number formats ($#,##0, 0.0%, dates, etc.) survive even
'                   when the cell holds a raw number rather than a DOLLAR/TEXT
'                   formula result.
'   - No 255-field cap (the file is read by VBA, not attached as a merge source)
'  Output: <project_name>_narr_data.csv in the SAME FOLDER as this workbook.
'  The CSV is built in a temp workbook and written with Workbook.SaveAs, which
'  Excel routes through its own SharePoint/OneDrive handler - so the https://
'  workbook path works directly. No local sync, WebDAV or ADODB needed.
'  Falls back to xlCSV, then to the Documents folder, on error.
'  RUN: Alt+F8 > ExportMergeDataCSV
'  PAIR WITH: PopulateNarrativeFromCSV (in the Word narrative document).
' ============================================================
Public Sub ExportMergeDataCSV()
    Dim wsArch As Worksheet, wsData As Worksheet
    Dim lastRow As Long, lastCol As Long, c As Long, i As Long, n As Long
    Dim names As Variant, hdr As Variant
    Dim vals() As String
    Dim dict As Object
    Dim nm As String, v As String, missing As String
    Dim proj As String, fname As String, msg As String
    Dim savePath As String, sep As String, savedTo As String
    Dim outArr() As String
    Dim newWb As Workbook
    Dim bad As Variant, b As Variant

    Set wsArch = ThisWorkbook.Worksheets("_Merge Architecture")
    Set wsData = ThisWorkbook.Worksheets("Merge Data")

    If Len(ThisWorkbook.Path) = 0 Then
        MsgBox "Please save this workbook before exporting.", vbExclamation, "ExportMergeDataCSV"
        Exit Sub
    End If

    lastRow = wsArch.Cells(wsArch.Rows.Count, "G").End(xlUp).Row
    If lastRow < 2 Then
        MsgBox "No fields in registry (col G).", vbExclamation, "ExportMergeDataCSV"
        Exit Sub
    End If

    names = wsArch.Range("G2:G" & lastRow).Value
    lastCol = wsData.Cells(1, wsData.Columns.Count).End(xlToLeft).Column
    hdr = wsData.Range(wsData.Cells(1, 1), wsData.Cells(1, lastCol)).Value

    ' Row 2 values are captured as DISPLAYED text, not raw .Value, so the
    ' cell's number format is baked into the exported string.
    ReDim vals(1 To lastCol)
    For c = 1 To lastCol
        vals(c) = DisplayText(wsData.Cells(2, c))
    Next c

    Set dict = CreateObject("Scripting.Dictionary")
    For c = 1 To lastCol
        If Len(Trim$(CStr(hdr(1, c)))) > 0 Then dict(CStr(hdr(1, c))) = c
    Next c

    ' Build a 2-column block: field_name / value. Excel does the CSV quoting on save.
    ReDim outArr(1 To UBound(names, 1) + 1, 1 To 2)
    outArr(1, 1) = "field_name": outArr(1, 2) = "value"
    For i = 1 To UBound(names, 1)
        nm = Trim$(CStr(names(i, 1)))
        If Len(nm) > 0 Then
            If dict.Exists(nm) Then
                v = vals(dict(nm))
                v = Replace(Replace(Replace(v, vbCrLf, " "), vbLf, " "), vbCr, " ")
                n = n + 1
                outArr(n + 1, 1) = nm
                outArr(n + 1, 2) = v
            Else
                missing = missing & nm & ", "
            End If
        End If
    Next i

    proj = "Project"
    If dict.Exists("project_name") Then
        If Len(Trim$(vals(dict("project_name")))) > 0 Then proj = Trim$(vals(dict("project_name")))
    End If
    bad = Array("\", "/", ":", "*", "?", """", "<", ">", "|")
    For Each b In bad: proj = Replace(proj, CStr(b), ""): Next b
    fname = proj & "_narr_data.csv"

    sep = Application.PathSeparator
    If LCase$(Left$(ThisWorkbook.Path, 4)) = "http" Then sep = "/"
    savePath = ThisWorkbook.Path & sep & fname

    Application.ScreenUpdating = False
    Application.DisplayAlerts = False

    Set newWb = Workbooks.Add(xlWBATWorksheet)
    With newWb.Sheets(1)
        .Cells.NumberFormat = "@"   ' text format first, so "$1,250,000" and "12.5%" stay strings
        .Range("A1").Resize(UBound(outArr, 1), 2).Value = outArr
        If n + 1 < UBound(outArr, 1) Then .Rows((n + 2) & ":" & UBound(outArr, 1)).Delete
    End With

    On Error Resume Next
    Err.Clear
    newWb.SaveAs Filename:=savePath, FileFormat:=62, Local:=False   ' 62 = xlCSVUTF8
    If Err.Number <> 0 Then
        Err.Clear
        newWb.SaveAs Filename:=savePath, FileFormat:=xlCSV, Local:=False
    End If
    If Err.Number <> 0 Then
        Err.Clear
        savePath = Environ$("USERPROFILE") & "\Documents\" & fname
        newWb.SaveAs Filename:=savePath, FileFormat:=xlCSV, Local:=False
    End If
    If Err.Number <> 0 Then
        msg = "Could not save the CSV." & vbCrLf & "Error " & Err.Number & ": " & Err.Description
        Err.Clear
        newWb.Close SaveChanges:=False
        Application.DisplayAlerts = True
        Application.ScreenUpdating = True
        On Error GoTo 0
        MsgBox msg, vbCritical, "ExportMergeDataCSV"
        Exit Sub
    End If
    On Error GoTo 0

    savedTo = newWb.FullName
    newWb.Close SaveChanges:=False
    Set newWb = Nothing
    Application.DisplayAlerts = True
    Application.ScreenUpdating = True

    msg = n & " fields exported to:" & vbCrLf & savedTo
    If Len(missing) > 0 Then msg = msg & vbCrLf & vbCrLf & "WARNING - not found in Merge Data row 1: " & Left$(missing, Len(missing) - 2)
    MsgBox msg, vbInformation, "ExportMergeDataCSV"
End Sub

' ------------------------------------------------------------
' Returns the cell exactly as Excel displays it (number format applied).
'   - Strings (incl. DOLLAR/TEXT formula results) pass through unchanged.
'   - Numbers/dates get the cell's NumberFormat applied.
'   - If the column is too narrow and .Text shows "#####", the format is
'     re-applied via WorksheetFunction.Text so the true value is exported.
'   - Error values (#N/A, #REF!, ...) export as an empty string.
' ------------------------------------------------------------
Private Function DisplayText(ByVal cel As Range) As String
    Dim t As String, raw As Variant, fmt As String

    raw = cel.Value2
    If IsError(raw) Then
        DisplayText = ""
        Exit Function
    End If
    If IsEmpty(raw) Then
        DisplayText = ""
        Exit Function
    End If
    If VarType(raw) = vbString Then
        DisplayText = CStr(raw)
        Exit Function
    End If

    t = cel.Text
    ' .Text returns "####" when the column is too narrow to show the number.
    If Len(t) > 0 And Len(Replace(t, "#", "")) = 0 Then
        fmt = cel.NumberFormat
        On Error Resume Next
        t = Application.WorksheetFunction.Text(raw, fmt)
        If Err.Number <> 0 Then
            Err.Clear
            t = CStr(raw)
        End If
        On Error GoTo 0
    End If
    DisplayText = t
End Function
